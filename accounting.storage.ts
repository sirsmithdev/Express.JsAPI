/**
 * Accounting Storage Module
 * Handles all accounting and finance-related data operations:
 * - Expenses tracking and categorization
 * - Vendor management
 * - Vendor bills and payments
 * - Financial reports (AR/AP aging, cash flow, statements)
 * - Payment reminder settings
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
  sum,
  expenses,
  expenseNumberSequence,
  type Expense,
  type InsertExpense,
  type UpdateExpense,
  vendors,
  vendorNumberSequence,
  type Vendor,
  type InsertVendor,
  vendorBills,
  vendorBillNumberSequence,
  type VendorBill,
  type InsertVendorBill,
  vendorBillLineItems,
  type VendorBillLineItem,
  type InsertVendorBillLineItem,
  vendorPayments,
  vendorPaymentNumberSequence,
  type VendorPayment,
  type InsertVendorPayment,
  paymentReminderSettings,
  type PaymentReminderSettings,
  type InsertPaymentReminderSettings,
  paymentRemindersLog,
  type PaymentReminderLog,
  invoices,
  payments,
  rentalPayments,
  towRequests,
  users,
} from "./base";

class AccountingStorage {
  // ============================================================
  // EXPENSES MANAGEMENT
  // ============================================================

  async getExpense(id: string): Promise<Expense | undefined> {
    const result = await db.select().from(expenses).where(eq(expenses.id, id)).limit(1);
    return result[0];
  }

  async getExpenseByNumber(expenseNumber: string): Promise<Expense | undefined> {
    const result = await db.select().from(expenses).where(eq(expenses.expenseNumber, expenseNumber)).limit(1);
    return result[0];
  }

  async getAllExpenses(): Promise<Expense[]> {
    return await db.select().from(expenses).orderBy(desc(expenses.expenseDate));
  }

  async getExpensesByDateRange(startDate: Date, endDate: Date): Promise<Expense[]> {
    return await db
      .select()
      .from(expenses)
      .where(and(gte(expenses.expenseDate, startDate), lte(expenses.expenseDate, endDate)))
      .orderBy(desc(expenses.expenseDate));
  }

  async getExpensesByCategory(category: string): Promise<Expense[]> {
    return await db
      .select()
      .from(expenses)
      .where(sql`${expenses.category} = ${category}`)
      .orderBy(desc(expenses.expenseDate));
  }

  async getExpensesByServiceType(serviceType: string): Promise<Expense[]> {
    return await db
      .select()
      .from(expenses)
      .where(sql`${expenses.serviceType} = ${serviceType}`)
      .orderBy(desc(expenses.expenseDate));
  }

  async createExpense(expense: InsertExpense): Promise<Expense> {
    const expenseNumber = await this.generateExpenseNumber();
    const result = await db.insert(expenses).values({ ...expense, expenseNumber }).returning();
    return result[0];
  }

  async updateExpense(id: string, expense: UpdateExpense): Promise<Expense | undefined> {
    const result = await db
      .update(expenses)
      .set({ ...expense, updatedAt: new Date() })
      .where(eq(expenses.id, id))
      .returning();
    return result[0];
  }

  async deleteExpense(id: string): Promise<void> {
    await db.delete(expenses).where(eq(expenses.id, id));
  }

  async generateExpenseNumber(): Promise<string> {
    const currentYear = new Date().getFullYear();

    const result = await db.transaction(async (tx) => {
      let sequence = await tx
        .select()
        .from(expenseNumberSequence)
        .where(eq(expenseNumberSequence.year, currentYear))
        .limit(1);

      let nextNumber: number;
      if (sequence.length === 0) {
        await tx.insert(expenseNumberSequence).values({ year: currentYear, lastNumber: 1 });
        nextNumber = 1;
      } else {
        nextNumber = sequence[0].lastNumber + 1;
        await tx
          .update(expenseNumberSequence)
          .set({ lastNumber: nextNumber })
          .where(eq(expenseNumberSequence.year, currentYear));
      }

      return `EXP-${currentYear}-${String(nextNumber).padStart(4, '0')}`;
    });

    return result;
  }

  // ============================================================
  // VENDOR MANAGEMENT
  // ============================================================

  async getNextVendorNumber(): Promise<string> {
    const [sequence] = await db
      .select()
      .from(vendorNumberSequence)
      .where(eq(vendorNumberSequence.id, 1))
      .limit(1);

    if (!sequence) {
      await db.insert(vendorNumberSequence).values({ id: 1, lastNumber: 0 });
      return "VEN-0001";
    }

    const nextNumber = sequence.lastNumber + 1;
    await db
      .update(vendorNumberSequence)
      .set({ lastNumber: nextNumber })
      .where(eq(vendorNumberSequence.id, 1));

    return `VEN-${String(nextNumber).padStart(4, "0")}`;
  }

  async createVendor(data: InsertVendor): Promise<Vendor> {
    const vendorNumber = await this.getNextVendorNumber();
    const [vendor] = await db
      .insert(vendors)
      .values({ ...data, vendorNumber })
      .returning();

    return vendor;
  }

  async getAllVendors(filters?: { isActive?: boolean }): Promise<Vendor[]> {
    let query = db.select().from(vendors);

    if (filters?.isActive !== undefined) {
      query = query.where(eq(vendors.isActive, filters.isActive)) as any;
    }

    return await query.orderBy(desc(vendors.createdAt));
  }

  async getVendorById(id: string): Promise<Vendor | undefined> {
    const [vendor] = await db
      .select()
      .from(vendors)
      .where(eq(vendors.id, id))
      .limit(1);

    return vendor;
  }

  async updateVendor(id: string, updates: Partial<Vendor>): Promise<Vendor> {
    const [updated] = await db
      .update(vendors)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(vendors.id, id))
      .returning();

    return updated;
  }

  async deleteVendor(id: string): Promise<void> {
    await db.delete(vendors).where(eq(vendors.id, id));
  }

  // ============================================================
  // VENDOR BILLS MANAGEMENT
  // ============================================================

  async getNextVendorBillNumber(): Promise<string> {
    const currentYear = new Date().getFullYear();

    const [sequence] = await db
      .select()
      .from(vendorBillNumberSequence)
      .where(eq(vendorBillNumberSequence.year, currentYear))
      .limit(1);

    if (!sequence) {
      await db.insert(vendorBillNumberSequence).values({ year: currentYear, lastNumber: 0 });
      return `BILL-${currentYear}-0001`;
    }

    const nextNumber = sequence.lastNumber + 1;
    await db
      .update(vendorBillNumberSequence)
      .set({ lastNumber: nextNumber })
      .where(eq(vendorBillNumberSequence.year, currentYear));

    return `BILL-${currentYear}-${String(nextNumber).padStart(4, "0")}`;
  }

  async createVendorBill(data: InsertVendorBill, lineItems: InsertVendorBillLineItem[]): Promise<VendorBill> {
    const billNumber = await this.getNextVendorBillNumber();
    const [bill] = await db
      .insert(vendorBills)
      .values({ ...data, billNumber })
      .returning();

    if (lineItems.length > 0) {
      await db.insert(vendorBillLineItems).values(
        lineItems.map(item => ({ ...item, billId: bill.id }))
      );
    }

    return bill;
  }

  async getAllVendorBills(filters?: { vendorId?: string; status?: string }): Promise<VendorBill[]> {
    let query = db.select().from(vendorBills);

    const conditions = [];
    if (filters?.vendorId) {
      conditions.push(eq(vendorBills.vendorId, filters.vendorId));
    }
    if (filters?.status) {
      conditions.push(eq(vendorBills.status, filters.status));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    return await query.orderBy(desc(vendorBills.billDate));
  }

  async getVendorBillById(id: string): Promise<VendorBill | undefined> {
    const [bill] = await db
      .select()
      .from(vendorBills)
      .where(eq(vendorBills.id, id))
      .limit(1);

    return bill;
  }

  async getVendorBillLineItems(billId: string): Promise<VendorBillLineItem[]> {
    return await db
      .select()
      .from(vendorBillLineItems)
      .where(eq(vendorBillLineItems.billId, billId));
  }

  async updateVendorBill(id: string, updates: Partial<VendorBill>): Promise<VendorBill> {
    const [updated] = await db
      .update(vendorBills)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(vendorBills.id, id))
      .returning();

    return updated;
  }

  async deleteVendorBill(id: string): Promise<void> {
    await db.delete(vendorBills).where(eq(vendorBills.id, id));
  }

  // ============================================================
  // VENDOR PAYMENTS MANAGEMENT
  // ============================================================

  async getNextVendorPaymentNumber(): Promise<string> {
    const currentYear = new Date().getFullYear();

    const [sequence] = await db
      .select()
      .from(vendorPaymentNumberSequence)
      .where(eq(vendorPaymentNumberSequence.year, currentYear))
      .limit(1);

    if (!sequence) {
      await db.insert(vendorPaymentNumberSequence).values({ year: currentYear, lastNumber: 0 });
      return `VPM-${currentYear}-0001`;
    }

    const nextNumber = sequence.lastNumber + 1;
    await db
      .update(vendorPaymentNumberSequence)
      .set({ lastNumber: nextNumber })
      .where(eq(vendorPaymentNumberSequence.year, currentYear));

    return `VPM-${currentYear}-${String(nextNumber).padStart(4, "0")}`;
  }

  async createVendorPayment(data: InsertVendorPayment): Promise<VendorPayment> {
    const paymentNumber = await this.getNextVendorPaymentNumber();
    const [payment] = await db
      .insert(vendorPayments)
      .values({ ...data, paymentNumber })
      .returning();

    // Update bill if linked
    if (data.billId) {
      const bill = await this.getVendorBillById(data.billId);
      if (bill) {
        const newAmountPaid = parseFloat(bill.amountPaid) + parseFloat(data.amount);
        const total = parseFloat(bill.total);
        const newStatus = newAmountPaid >= total ? "paid" : "partially_paid";

        await this.updateVendorBill(bill.id, {
          amountPaid: newAmountPaid.toString(),
          status: newStatus,
        });
      }
    }

    return payment;
  }

  async getAllVendorPayments(filters?: { vendorId?: string; billId?: string }): Promise<VendorPayment[]> {
    let query = db.select().from(vendorPayments);

    const conditions = [];
    if (filters?.vendorId) {
      conditions.push(eq(vendorPayments.vendorId, filters.vendorId));
    }
    if (filters?.billId) {
      conditions.push(eq(vendorPayments.billId, filters.billId));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    return await query.orderBy(desc(vendorPayments.paymentDate));
  }

  async getVendorPaymentById(id: string): Promise<VendorPayment | undefined> {
    const [payment] = await db
      .select()
      .from(vendorPayments)
      .where(eq(vendorPayments.id, id))
      .limit(1);

    return payment;
  }

  // ============================================================
  // FINANCIAL REPORTS
  // ============================================================

  async getFinancialSummary(startDate: Date, endDate: Date): Promise<{
    totalRevenue: number;
    totalExpenses: number;
    netProfit: number;
    revenueByServiceType: Record<string, number>;
    expensesByCategory: Record<string, number>;
    expensesByServiceType: Record<string, number>;
  }> {
    // Calculate total revenue from invoices
    const invoiceRevenue = await db
      .select({ total: sum(invoices.total) })
      .from(invoices)
      .where(
        and(
          gte(invoices.issueDate, startDate),
          lte(invoices.issueDate, endDate),
          inArray(invoices.status, ['paid', 'partially_paid'])
        )
      );

    // Calculate rental revenue
    const rentalRevenue = await db
      .select({ total: sum(rentalPayments.amount) })
      .from(rentalPayments)
      .where(
        and(
          gte(rentalPayments.createdAt, startDate),
          lte(rentalPayments.createdAt, endDate)
        )
      );

    // Calculate towing revenue from completed tow requests
    const towingRevenue = await db
      .select({ total: sum(towRequests.totalPrice) })
      .from(towRequests)
      .where(
        and(
          gte(towRequests.createdAt, startDate),
          lte(towRequests.createdAt, endDate),
          eq(towRequests.status, 'completed')
        )
      );

    const totalRevenue =
      Number(invoiceRevenue[0]?.total || 0) +
      Number(rentalRevenue[0]?.total || 0) +
      Number(towingRevenue[0]?.total || 0);

    // Calculate total expenses
    const expenseSum = await db
      .select({ total: sum(expenses.amount) })
      .from(expenses)
      .where(
        and(
          gte(expenses.expenseDate, startDate),
          lte(expenses.expenseDate, endDate)
        )
      );

    const totalExpenses = Number(expenseSum[0]?.total || 0);

    // Revenue by service type
    const revenueByServiceType: Record<string, number> = {
      repair_services: Number(invoiceRevenue[0]?.total || 0),
      rental_services: Number(rentalRevenue[0]?.total || 0),
      towing_services: Number(towingRevenue[0]?.total || 0),
    };

    // Expenses by category
    const expensesByCategoryQuery = await db
      .select({
        category: expenses.category,
        total: sum(expenses.amount),
      })
      .from(expenses)
      .where(
        and(
          gte(expenses.expenseDate, startDate),
          lte(expenses.expenseDate, endDate)
        )
      )
      .groupBy(expenses.category);

    const expensesByCategory: Record<string, number> = {};
    expensesByCategoryQuery.forEach(row => {
      if (row.category) {
        expensesByCategory[row.category] = Number(row.total || 0);
      }
    });

    // Expenses by service type
    const expensesByServiceTypeQuery = await db
      .select({
        serviceType: expenses.serviceType,
        total: sum(expenses.amount),
      })
      .from(expenses)
      .where(
        and(
          gte(expenses.expenseDate, startDate),
          lte(expenses.expenseDate, endDate)
        )
      )
      .groupBy(expenses.serviceType);

    const expensesByServiceType: Record<string, number> = {};
    expensesByServiceTypeQuery.forEach(row => {
      if (row.serviceType) {
        expensesByServiceType[row.serviceType] = Number(row.total || 0);
      }
    });

    return {
      totalRevenue,
      totalExpenses,
      netProfit: totalRevenue - totalExpenses,
      revenueByServiceType,
      expensesByCategory,
      expensesByServiceType,
    };
  }

  // AR (Accounts Receivable) Aging Report
  async getARAgingReport(): Promise<any[]> {
    const today = new Date();

    const invoicesData = await db
      .select()
      .from(invoices)
      .leftJoin(users, eq(invoices.customerId, users.id))
      .where(or(eq(invoices.status, "sent"), eq(invoices.status, "partially_paid"), eq(invoices.status, "overdue")));

    const agingData = new Map();

    for (const { invoices: invoice, users: customer } of invoicesData) {
      if (!customer) continue;

      const outstanding = parseFloat(invoice.total) - parseFloat(invoice.amountPaid || "0");
      if (outstanding <= 0) continue;

      const dueDate = new Date(invoice.dueDate || invoice.issueDate);
      const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

      if (!agingData.has(customer.id)) {
        agingData.set(customer.id, {
          customerId: customer.id,
          customerName: `${customer.firstName} ${customer.lastName}`,
          customerEmail: customer.email,
          current: 0,
          days30: 0,
          days60: 0,
          days90: 0,
          days90Plus: 0,
          total: 0,
        });
      }

      const record = agingData.get(customer.id);

      if (daysOverdue < 0) {
        record.current += outstanding;
      } else if (daysOverdue < 30) {
        record.days30 += outstanding;
      } else if (daysOverdue < 60) {
        record.days60 += outstanding;
      } else if (daysOverdue < 90) {
        record.days90 += outstanding;
      } else {
        record.days90Plus += outstanding;
      }

      record.total += outstanding;
    }

    return Array.from(agingData.values());
  }

  // Customer Payment History
  async getCustomerPaymentHistory(customerId: string): Promise<any[]> {
    return await db
      .select({
        paymentId: payments.id,
        paymentNumber: payments.paymentNumber,
        invoiceId: payments.invoiceId,
        invoiceNumber: invoices.invoiceNumber,
        amount: payments.amount,
        paymentMethod: payments.paymentMethod,
        paymentDate: payments.paymentDate,
        transactionId: payments.transactionId,
        notes: payments.notes,
      })
      .from(payments)
      .leftJoin(invoices, eq(payments.invoiceId, invoices.id))
      .where(eq(invoices.customerId, customerId))
      .orderBy(desc(payments.paymentDate));
  }

  // Outstanding Invoices
  async getOutstandingInvoices(): Promise<any[]> {
    return await db
      .select({
        invoiceId: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        customerId: invoices.customerId,
        customerName: sql<string>`${users.firstName} || ' ' || ${users.lastName}`,
        total: invoices.total,
        amountPaid: invoices.amountPaid,
        outstanding: sql<string>`CAST(${invoices.total} AS DECIMAL) - CAST(COALESCE(${invoices.amountPaid}, 0) AS DECIMAL)`,
        issueDate: invoices.issueDate,
        dueDate: invoices.dueDate,
        status: invoices.status,
        daysOverdue: sql<number>`CASE WHEN ${invoices.dueDate} < NOW() THEN EXTRACT(DAY FROM NOW() - ${invoices.dueDate}) ELSE 0 END`,
      })
      .from(invoices)
      .leftJoin(users, eq(invoices.customerId, users.id))
      .where(or(eq(invoices.status, "sent"), eq(invoices.status, "partially_paid"), eq(invoices.status, "overdue")))
      .orderBy(desc(invoices.dueDate));
  }

  // Cash Flow Statement Data
  async getCashFlowData(startDate: Date, endDate: Date): Promise<any> {
    // Operating Activities - Cash from customers (invoice payments)
    const operatingInflows = await db
      .select({
        total: sum(payments.amount),
      })
      .from(payments)
      .where(and(
        gte(payments.paymentDate, startDate),
        lte(payments.paymentDate, endDate)
      ));

    // Operating Activities - Cash to vendors and expenses
    const operatingOutflows = await db
      .select({
        total: sum(expenses.amount),
      })
      .from(expenses)
      .where(and(
        gte(expenses.expenseDate, startDate),
        lte(expenses.expenseDate, endDate)
      ));

    const vendorPaymentsOutflows = await db
      .select({
        total: sum(vendorPayments.amount),
      })
      .from(vendorPayments)
      .where(and(
        gte(vendorPayments.paymentDate, startDate),
        lte(vendorPayments.paymentDate, endDate)
      ));

    const operatingInflowsTotal = parseFloat(operatingInflows[0]?.total || "0");
    const operatingOutflowsTotal = parseFloat(operatingOutflows[0]?.total || "0") + parseFloat(vendorPaymentsOutflows[0]?.total || "0");

    return {
      operatingActivities: {
        inflows: operatingInflowsTotal,
        outflows: operatingOutflowsTotal,
        net: operatingInflowsTotal - operatingOutflowsTotal,
      },
      // Investing and financing activities would be tracked separately
      // For now, we'll return placeholder data
      investingActivities: {
        inflows: 0,
        outflows: 0,
        net: 0,
      },
      financingActivities: {
        inflows: 0,
        outflows: 0,
        net: 0,
      },
      netCashFlow: operatingInflowsTotal - operatingOutflowsTotal,
    };
  }

  // Vendor Aging Report (AP - Accounts Payable)
  async getVendorAgingReport(): Promise<any[]> {
    const today = new Date();

    const bills = await db
      .select()
      .from(vendorBills)
      .leftJoin(vendors, eq(vendorBills.vendorId, vendors.id))
      .where(or(eq(vendorBills.status, "unpaid"), eq(vendorBills.status, "partially_paid")));

    const agingData = new Map();

    for (const { vendor_bills, vendors: vendor } of bills) {
      if (!vendor) continue;

      const outstanding = parseFloat(vendor_bills.total) - parseFloat(vendor_bills.amountPaid);
      const dueDate = new Date(vendor_bills.dueDate || vendor_bills.billDate);
      const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

      if (!agingData.has(vendor.id)) {
        agingData.set(vendor.id, {
          vendorId: vendor.id,
          vendorName: vendor.vendorName,
          current: 0,
          days30: 0,
          days60: 0,
          days90: 0,
          days90Plus: 0,
          total: 0,
        });
      }

      const record = agingData.get(vendor.id);

      if (daysOverdue < 0) {
        record.current += outstanding;
      } else if (daysOverdue < 30) {
        record.days30 += outstanding;
      } else if (daysOverdue < 60) {
        record.days60 += outstanding;
      } else if (daysOverdue < 90) {
        record.days90 += outstanding;
      } else {
        record.days90Plus += outstanding;
      }

      record.total += outstanding;
    }

    return Array.from(agingData.values());
  }

  // Customer Statement Generation
  async getCustomerStatement(customerId: string, startDate?: Date, endDate?: Date): Promise<any> {
    // Default to last 90 days if no date range provided
    const end = endDate || new Date();
    const start = startDate || new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000);

    // Get customer info - Need to import from users storage
    // For now, we'll fetch directly
    const [customer] = await db.select().from(users).where(eq(users.id, customerId)).limit(1);
    if (!customer) {
      throw new Error("Customer not found");
    }

    // Get all invoices in date range
    const allInvoices = await db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.customerId, customerId),
          gte(invoices.issueDate, start),
          lte(invoices.issueDate, end)
        )
      )
      .orderBy(desc(invoices.issueDate));

    // Get outstanding invoices
    const outstandingInvoices = await db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.customerId, customerId),
          or(
            eq(invoices.status, "sent"),
            eq(invoices.status, "partially_paid"),
            eq(invoices.status, "overdue")
          )
        )
      )
      .orderBy(desc(invoices.dueDate));

    // Get payment history in date range
    const paymentHistory = await db
      .select({
        payment: payments,
        invoice: invoices,
      })
      .from(payments)
      .leftJoin(invoices, eq(payments.invoiceId, invoices.id))
      .where(
        and(
          eq(invoices.customerId, customerId),
          gte(payments.paymentDate, start),
          lte(payments.paymentDate, end)
        )
      )
      .orderBy(desc(payments.paymentDate));

    // Calculate account summary
    const totalInvoiced = allInvoices.reduce(
      (sum, inv) => sum + parseFloat(inv.total),
      0
    );
    const totalPaid = allInvoices.reduce(
      (sum, inv) => sum + parseFloat(inv.amountPaid || "0"),
      0
    );
    const outstandingBalance = outstandingInvoices.reduce(
      (sum, inv) => sum + (parseFloat(inv.total) - parseFloat(inv.amountPaid || "0")),
      0
    );

    // Calculate aging breakdown for outstanding invoices
    const today = new Date();
    const aging = {
      current: 0,
      days30: 0,
      days60: 0,
      days90: 0,
      days90Plus: 0,
    };

    for (const invoice of outstandingInvoices) {
      const outstanding = parseFloat(invoice.total) - parseFloat(invoice.amountPaid || "0");
      const dueDate = new Date(invoice.dueDate || invoice.issueDate);
      const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

      if (daysOverdue < 0) {
        aging.current += outstanding;
      } else if (daysOverdue < 30) {
        aging.days30 += outstanding;
      } else if (daysOverdue < 60) {
        aging.days60 += outstanding;
      } else if (daysOverdue < 90) {
        aging.days90 += outstanding;
      } else {
        aging.days90Plus += outstanding;
      }
    }

    // Format outstanding invoices with days overdue
    const formattedOutstanding = outstandingInvoices.map((invoice) => {
      const outstanding = parseFloat(invoice.total) - parseFloat(invoice.amountPaid || "0");
      const dueDate = new Date(invoice.dueDate || invoice.issueDate);
      const daysOverdue = Math.max(0, Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)));

      return {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        total: invoice.total,
        amountPaid: invoice.amountPaid,
        outstanding,
        status: invoice.status,
        daysOverdue,
      };
    });

    return {
      customer: {
        id: customer.id,
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email,
        phone: customer.phone,
        accountNumber: customer.accountNumber,
      },
      statementPeriod: {
        startDate: start,
        endDate: end,
      },
      accountSummary: {
        totalInvoiced,
        totalPaid,
        outstandingBalance,
      },
      aging,
      outstandingInvoices: formattedOutstanding,
      paymentHistory: paymentHistory.map((ph) => ({
        paymentId: ph.payment.id,
        paymentNumber: ph.payment.paymentNumber,
        paymentDate: ph.payment.paymentDate,
        amount: ph.payment.amount,
        paymentMethod: ph.payment.paymentMethod,
        invoiceNumber: ph.invoice?.invoiceNumber,
        invoiceId: ph.invoice?.id,
      })),
      allInvoices: allInvoices.map((inv) => ({
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        total: inv.total,
        amountPaid: inv.amountPaid,
        status: inv.status,
      })),
    };
  }

  // ============================================================
  // PAYMENT REMINDER SETTINGS
  // ============================================================

  async getPaymentReminderSettings(): Promise<PaymentReminderSettings | null> {
    const [settings] = await db
      .select()
      .from(paymentReminderSettings)
      .where(eq(paymentReminderSettings.id, 1))
      .limit(1);
    return settings || null;
  }

  async updatePaymentReminderSettings(data: Partial<InsertPaymentReminderSettings>): Promise<PaymentReminderSettings> {
    const [settings] = await db
      .select()
      .from(paymentReminderSettings)
      .where(eq(paymentReminderSettings.id, 1))
      .limit(1);

    if (settings) {
      const [updated] = await db
        .update(paymentReminderSettings)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(paymentReminderSettings.id, 1))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(paymentReminderSettings)
        .values({ id: 1, ...data })
        .returning();
      return created;
    }
  }

  async getPaymentRemindersLog(filters?: {
    invoiceId?: string;
    customerId?: string;
    reminderType?: string;
  }): Promise<PaymentReminderLog[]> {
    const conditions = [];

    if (filters?.invoiceId) {
      conditions.push(eq(paymentRemindersLog.invoiceId, filters.invoiceId));
    }
    if (filters?.customerId) {
      conditions.push(eq(paymentRemindersLog.customerId, filters.customerId));
    }
    if (filters?.reminderType) {
      conditions.push(eq(paymentRemindersLog.reminderType, filters.reminderType));
    }

    return db
      .select()
      .from(paymentRemindersLog)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(paymentRemindersLog.sentAt));
  }
}

// Export singleton instance
export const accountingStorage = new AccountingStorage();
