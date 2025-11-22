/**
 * Reviews Storage Module
 * Handles all staff review operations including ratings, analytics, and exports
 */

import {
  db,
  eq,
  and,
  or,
  desc,
  gte,
  lte,
  // Reviews-related tables
  staffReviews,
  invoices,
  jobCards,
  users,
  // Reviews-related types
  type StaffReview,
  type InsertStaffReview,
} from "./base";

class ReviewsStorage {
  // ========================================
  // STAFF REVIEWS
  // ========================================

  async createStaffReview(review: InsertStaffReview): Promise<StaffReview> {
    const [newReview] = await db.insert(staffReviews).values(review).returning();

    // Mark invoice as reviewed
    await db.update(invoices)
      .set({ reviewSubmitted: true })
      .where(eq(invoices.id, review.invoiceId));

    // Also mark job card as reviewed if it exists
    if (review.jobCardId) {
      await db.update(jobCards)
        .set({ reviewSubmitted: true })
        .where(eq(jobCards.id, review.jobCardId));
    }

    return newReview;
  }

  async getReviewByInvoice(invoiceId: string): Promise<StaffReview | undefined> {
    const [review] = await db
      .select()
      .from(staffReviews)
      .where(eq(staffReviews.invoiceId, invoiceId))
      .limit(1);
    return review;
  }

  async getReviewByJobCard(jobCardId: string): Promise<StaffReview | undefined> {
    const [review] = await db
      .select()
      .from(staffReviews)
      .where(eq(staffReviews.jobCardId, jobCardId))
      .limit(1);
    return review;
  }

  async getReviewsByStaff(staffId: string): Promise<StaffReview[]> {
    return await db
      .select()
      .from(staffReviews)
      .where(or(
        eq(staffReviews.mechanicId, staffId),
        eq(staffReviews.receptionistId, staffId)
      ))
      .orderBy(desc(staffReviews.createdAt));
  }

  async getReviewsByCustomer(customerId: string): Promise<StaffReview[]> {
    return await db
      .select()
      .from(staffReviews)
      .where(eq(staffReviews.customerId, customerId))
      .orderBy(desc(staffReviews.createdAt));
  }

  async getAllReviews(): Promise<StaffReview[]> {
    return await db
      .select()
      .from(staffReviews)
      .orderBy(desc(staffReviews.createdAt));
  }

  async getStaffRatingStats(staffId: string): Promise<{
    averageOverall: number;
    averageMechanicWork: number;
    averageMechanicService: number;
    averageOfficeService: number;
    totalReviews: number;
    recommendationRate: number;
  }> {
    const reviews = await this.getReviewsByStaff(staffId);

    if (reviews.length === 0) {
      return {
        averageOverall: 0,
        averageMechanicWork: 0,
        averageMechanicService: 0,
        averageOfficeService: 0,
        totalReviews: 0,
        recommendationRate: 0,
      };
    }

    const totals = reviews.reduce((acc, review) => ({
      overall: acc.overall + (review.overallExperience || 0),
      mechanicWork: acc.mechanicWork + (review.mechanicWorkQuality || 0),
      mechanicService: acc.mechanicService + (review.mechanicCustomerService || 0),
      officeService: acc.officeService + (review.officeStaffService || 0),
      recommendations: acc.recommendations + (review.wouldRecommend ? 1 : 0),
    }), { overall: 0, mechanicWork: 0, mechanicService: 0, officeService: 0, recommendations: 0 });

    const mechanicWorkCount = reviews.filter(r => r.mechanicWorkQuality !== null).length;
    const mechanicServiceCount = reviews.filter(r => r.mechanicCustomerService !== null).length;
    const officeServiceCount = reviews.filter(r => r.officeStaffService !== null).length;

    return {
      averageOverall: totals.overall / reviews.length,
      averageMechanicWork: mechanicWorkCount > 0 ? totals.mechanicWork / mechanicWorkCount : 0,
      averageMechanicService: mechanicServiceCount > 0 ? totals.mechanicService / mechanicServiceCount : 0,
      averageOfficeService: officeServiceCount > 0 ? totals.officeService / officeServiceCount : 0,
      totalReviews: reviews.length,
      recommendationRate: (totals.recommendations / reviews.length) * 100,
    };
  }

  async getRecentReviews(limit: number): Promise<StaffReview[]> {
    return await db
      .select()
      .from(staffReviews)
      .orderBy(desc(staffReviews.createdAt))
      .limit(limit);
  }

  async getReviewById(reviewId: string): Promise<StaffReview | undefined> {
    const [review] = await db
      .select()
      .from(staffReviews)
      .where(eq(staffReviews.id, reviewId))
      .limit(1);
    return review;
  }

  async updateReview(reviewId: string, updates: Partial<StaffReview>): Promise<StaffReview> {
    const [updated] = await db
      .update(staffReviews)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(staffReviews.id, reviewId))
      .returning();
    return updated;
  }

  async getReviewAnalytics(filters: {
    startDate?: Date;
    endDate?: Date;
    staffId?: string;
  }): Promise<{
    totalReviews: number;
    averageRating: number;
    recommendationRate: number;
    responseRate: number;
    ratingDistribution: Record<number, number>;
    trendsThisMonth: {
      reviews: number;
      change: number;
      trending: 'up' | 'down' | 'stable';
    };
    topPerformers: unknown[];
    recentActivity: unknown[];
  }> {
    // Build query with conditions
    const conditions = [];
    if (filters.startDate) {
      conditions.push(gte(staffReviews.createdAt, filters.startDate));
    }
    if (filters.endDate) {
      conditions.push(lte(staffReviews.createdAt, filters.endDate));
    }
    if (filters.staffId) {
      conditions.push(
        or(
          eq(staffReviews.mechanicId, filters.staffId),
          eq(staffReviews.receptionistId, filters.staffId)
        )
      );
    }

    const reviews = conditions.length > 0
      ? await db.select().from(staffReviews).where(and(...conditions))
      : await db.select().from(staffReviews);

    // Calculate analytics
    const totalReviews = reviews.length;
    const averageOverall = reviews.reduce((sum, r) => sum + r.overallExperience, 0) / totalReviews || 0;
    const recommendationRate = (reviews.filter(r => r.wouldRecommend).length / totalReviews) * 100 || 0;

    // Calculate rating distribution
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    reviews.forEach(r => {
      distribution[r.overallExperience as keyof typeof distribution]++;
    });

    // Calculate response metrics
    const reviewsWithResponses = reviews.filter(r => r.responseText);
    const responseRate = (reviewsWithResponses.length / totalReviews) * 100 || 0;

    // Calculate trends (compare with previous period)
    const now = new Date();
    const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

    const currentMonthReviews = await db.select().from(staffReviews)
      .where(gte(staffReviews.createdAt, startOfCurrentMonth));

    const lastMonthReviews = await db.select().from(staffReviews)
      .where(and(
        gte(staffReviews.createdAt, startOfLastMonth),
        lte(staffReviews.createdAt, endOfLastMonth)
      ));

    const change = lastMonthReviews.length > 0
      ? ((currentMonthReviews.length - lastMonthReviews.length) / lastMonthReviews.length) * 100
      : 0;

    const trending = change > 5 ? 'up' : change < -5 ? 'down' : 'stable';

    return {
      totalReviews,
      averageRating: parseFloat(averageOverall.toFixed(2)),
      recommendationRate: parseFloat(recommendationRate.toFixed(2)),
      responseRate: parseFloat(responseRate.toFixed(2)),
      ratingDistribution: distribution,
      trendsThisMonth: {
        reviews: currentMonthReviews.length,
        change: parseFloat(change.toFixed(2)),
        trending
      },
      topPerformers: [],
      recentActivity: []
    };
  }

  async getReviewsForExport(filters: {
    startDate?: Date;
    endDate?: Date;
    staffId?: string;
  }): Promise<Array<{
    reviewId: string;
    createdAt: Date;
    customerName: string;
    customerEmail?: string;
    invoiceNumber?: string;
    overallRating: number;
    mechanicWorkQuality: number | null;
    mechanicCustomerService: number | null;
    officeStaffService: number | null;
    wouldRecommend: boolean;
    comments: string | null;
    responseText: string | null;
    respondedAt: Date | null;
    status: string;
  }>> {
    // Build conditions
    const conditions = [];
    if (filters.startDate) {
      conditions.push(gte(staffReviews.createdAt, filters.startDate));
    }
    if (filters.endDate) {
      conditions.push(lte(staffReviews.createdAt, filters.endDate));
    }
    if (filters.staffId) {
      conditions.push(
        or(
          eq(staffReviews.mechanicId, filters.staffId),
          eq(staffReviews.receptionistId, filters.staffId)
        )
      );
    }

    const baseQuery = db
      .select({
        review: staffReviews,
        customer: users,
        invoice: invoices,
      })
      .from(staffReviews)
      .leftJoin(users, eq(staffReviews.customerId, users.id))
      .leftJoin(invoices, eq(staffReviews.invoiceId, invoices.id));

    const results = conditions.length > 0
      ? await baseQuery.where(and(...conditions))
      : await baseQuery;

    // Format for export
    return results.map(r => ({
      reviewId: r.review.id,
      createdAt: r.review.createdAt,
      customerName: r.customer ? `${r.customer.firstName} ${r.customer.lastName}` : 'Unknown',
      customerEmail: r.customer?.email,
      invoiceNumber: r.invoice?.invoiceNumber,
      overallRating: r.review.overallExperience,
      mechanicWorkQuality: r.review.mechanicWorkQuality,
      mechanicCustomerService: r.review.mechanicCustomerService,
      officeStaffService: r.review.officeStaffService,
      wouldRecommend: r.review.wouldRecommend,
      comments: r.review.comments,
      responseText: r.review.responseText,
      respondedAt: r.review.respondedAt,
      status: r.review.status,
    }));
  }

  convertReviewsToCSV(reviews: Array<Record<string, unknown>>): string {
    if (reviews.length === 0) return '';

    const headers = Object.keys(reviews[0]).join(',');
    const rows = reviews.map(r => {
      return Object.values(r).map(v => {
        // Escape values that contain commas or quotes
        if (v === null || v === undefined) return '';
        const str = String(v);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }).join(',');
    });

    return [headers, ...rows].join('\n');
  }

  async getPublicReviews(limit: number = 9): Promise<StaffReview[]> {
    // Get only published reviews with 4+ stars for public display
    return await db
      .select()
      .from(staffReviews)
      .where(
        and(
          eq(staffReviews.status, 'published'),
          gte(staffReviews.overallExperience, 4)
        )
      )
      .orderBy(desc(staffReviews.createdAt))
      .limit(limit);
  }
}

// Export singleton instance
export const reviewsStorage = new ReviewsStorage();
