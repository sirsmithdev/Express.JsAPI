/**
 * Invoice and Payment storage module
 * Handles all invoice, invoice item, and payment-related database operations
 */

import {
  db,
  eq,
  and,
  desc,
  sql,
  inArray,
  invoices,
  invoiceItems,
  payments,
  invoiceNumberSequence,
  users,
  jobCards,
  jobCardParts,
  partsInventory,
  pricingSettings,
  type Invoice,
  type InsertInvoice,
  type InvoiceItem,
  type InsertInvoiceItem,
  type Payment,
  type InsertPayment,
  type User,
} from "./base";

// ============================================================================
// Invoice Operations
// ============================================================================

/**
 * Get a single invoice by ID
 */
export async function getInvoice(id: string): Promise<Invoice | undefined> {
  const result = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
  return result[0];
}

/**
 * Get invoice by invoice number
 */
export async function getInvoiceByNumber(invoiceNumber: string): Promise<Invoice | undefined> {
  const result = await db.select().from(invoices).where(eq(invoices.invoiceNumber, invoiceNumber)).limit(1);
  return result[0];
}

/**
 * Get all invoices, optionally limited
 */
export async function getAllInvoices(options: { limit?: number } = {}): Promise<Invoice[]> {
  const query = db.select().from(invoices).orderBy(desc(invoices.createdAt));

  if (options.limit) {
    return await query.limit(options.limit);
  }

  return await query;
}

/**
 * Get all invoices for a specific customer
 */
export async function getInvoicesByCustomer(customerId: string): Promise<Invoice[]> {
  return await db.select().from(invoices).where(eq(invoices.customerId, customerId)).orderBy(desc(invoices.createdAt));
}

/**
 * Get all invoices for a specific job card
 */
export async function getInvoicesByJobCard(jobCardId: string): Promise<Invoice[]> {
  return await db.select().from(invoices).where(eq(invoices.jobCardId, jobCardId)).orderBy(desc(invoices.createdAt));
}

/**
 * Create a new invoice
 */
export async function createInvoice(invoice: InsertInvoice): Promise<Invoice> {
  const result = await db.insert(invoices).values(invoice).returning();
  return result[0];
}

/**
 * Create an invoice with line items in a single transaction
 */
export async function createInvoiceWithItems(invoice: InsertInvoice, items: InsertInvoiceItem[]): Promise<Invoice> {
  return await db.transaction(async (tx) => {
    const result = await tx.insert(invoices).values(invoice).returning();
    const createdInvoice = result[0];

    for (const item of items) {
      await tx.insert(invoiceItems).values({
        ...item,
        invoiceId: createdInvoice.id,
      }).returning();
    }

    return createdInvoice;
  });
}

/**
 * Update an existing invoice
 */
export async function updateInvoice(id: string, invoice: Partial<InsertInvoice>): Promise<Invoice | undefined> {
  const updateData = { ...invoice, updatedAt: new Date() };
  const result = await db.update(invoices).set(updateData).where(eq(invoices.id, id)).returning();
  return result[0];
}

/**
 * Generate a new sequential invoice number
 * Format: INV-YYYY-NNNN (e.g., INV-2025-0001)
 */
export async function generateInvoiceNumber(): Promise<string> {
  return await db.transaction(async (tx) => {
    const year = new Date().getFullYear();
    const prefix = `INV-${year}-`;

    const sequence = await tx
      .select()
      .from(invoiceNumberSequence)
      .where(eq(invoiceNumberSequence.year, year))
      .limit(1)
      .for('update');

    let nextNumber: number;

    if (sequence[0]) {
      nextNumber = sequence[0].lastNumber + 1;
      await tx
        .update(invoiceNumberSequence)
        .set({ lastNumber: nextNumber })
        .where(eq(invoiceNumberSequence.year, year));
    } else {
      nextNumber = 1;
      await tx
        .insert(invoiceNumberSequence)
        .values({ year, lastNumber: 1 })
        .onConflictDoUpdate({
          target: invoiceNumberSequence.year,
          set: { lastNumber: sql`${invoiceNumberSequence.lastNumber} + 1` },
        });
    }

    return `${prefix}${nextNumber.toString().padStart(4, '0')}`;
  });
}

/**
 * Generate invoice from job card with all parts and labor
 */
export async function generateInvoiceFromJobCard(jobCardId: string): Promise<Invoice> {
  return await db.transaction(async (tx) => {
    // Get job card
    const jobCard = await tx.select().from(jobCards).where(eq(jobCards.id, jobCardId)).limit(1);
    if (!jobCard[0]) {
      throw new Error("Job card not found");
    }
    const jc = jobCard[0];

    // Get job card parts
    const parts = await tx.select().from(jobCardParts).where(eq(jobCardParts.jobCardId, jobCardId));

    // Get pricing settings for tax rate
    const pricing = await tx.select().from(pricingSettings).where(eq(pricingSettings.id, 1)).limit(1);
    const taxRate = pricing[0]?.taxRate ? parseFloat(pricing[0].taxRate) / 100 : 0.15; // Default 15%

    // Generate invoice number
    const invoiceNumber = await generateInvoiceNumber();

    // Calculate invoice items
    const items: InsertInvoiceItem[] = [];
    let subtotal = 0;

    // Add parts as line items
    for (const part of parts) {
      // Get part details for name
      const partDetails = await tx.select().from(partsInventory).where(eq(partsInventory.id, part.partId)).limit(1);
      const partName = partDetails[0]?.name || "Part";

      const quantity = part.quantity;
      const unitPrice = parseFloat(part.priceAtTime);
      const total = quantity * unitPrice;
      subtotal += total;

      items.push({
        invoiceId: "", // Will be set after invoice creation
        description: partName,
        type: "parts",
        quantity: String(quantity),
        unitPrice: String(unitPrice),
        total: String(total.toFixed(2)),
      });
    }

    // Add labor if exists
    const laborHours = parseFloat(jc.laborHours || "0");
    const laborRate = parseFloat(jc.laborRate || "0");
    if (laborHours > 0 && laborRate > 0) {
      const laborTotal = laborHours * laborRate;
      subtotal += laborTotal;

      items.push({
        invoiceId: "", // Will be set after invoice creation
        description: "Labor",
        type: "labour",
        quantity: String(laborHours),
        unitPrice: String(laborRate),
        total: String(laborTotal.toFixed(2)),
      });
    }

    // Calculate tax and total
    const tax = subtotal * taxRate;
    const total = subtotal + tax;

    // Create invoice
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30); // 30 days from now

    const invoiceData: InsertInvoice = {
      invoiceNumber,
      jobCardId: jobCardId,
      customerId: jc.customerId,
      status: "draft",
      issueDate: new Date(),
      dueDate,
      subtotal: String(subtotal.toFixed(2)),
      tax: String(tax.toFixed(2)),
      total: String(total.toFixed(2)),
      paidAmount: "0",
      balance: String(total.toFixed(2)),
    };

    const result = await tx.insert(invoices).values(invoiceData).returning();
    const createdInvoice = result[0];

    // Create invoice items
    for (const item of items) {
      await tx.insert(invoiceItems).values({
        ...item,
        invoiceId: createdInvoice.id,
      });
    }

    return createdInvoice;
  });
}

// ============================================================================
// Batch Operations - Performance Optimizations
// ============================================================================

/**
 * Get invoices with all related data (line items, customer) in a single efficient query
 * This method fixes N+1 query issues when syncing invoices to external systems
 *
 * Instead of:
 *   const invoices = await getAllInvoices();
 *   for (const invoice of invoices) {
 *     const lineItems = await getInvoiceItems(invoice.id);  // N+1!
 *     const customer = await getUserById(invoice.customerId); // N+1!
 *   }
 *
 * Use:
 *   const invoicesWithDetails = await getInvoicesWithDetailsForSync({ limit: 100 });
 *   // All data is already loaded!
 */
export async function getInvoicesWithDetailsForSync(
  options: { limit?: number } = {}
): Promise<Array<Invoice & { lineItems: InvoiceItem[]; customer: User | null }>> {
  // Fetch invoices
  const invoiceList = await getAllInvoices(options);

  if (invoiceList.length === 0) {
    return [];
  }

  // Batch fetch all line items for these invoices
  const invoiceIds = invoiceList.map(inv => inv.id);
  const allLineItems = await db
    .select()
    .from(invoiceItems)
    .where(inArray(invoiceItems.invoiceId, invoiceIds));

  // Group line items by invoice ID
  const lineItemsByInvoice = allLineItems.reduce((acc, item) => {
    if (!acc[item.invoiceId]) {
      acc[item.invoiceId] = [];
    }
    acc[item.invoiceId].push(item);
    return acc;
  }, {} as Record<string, InvoiceItem[]>);

  // Batch fetch all customers
  const customerIds = Array.from(new Set(invoiceList.map(inv => inv.customerId)));
  const allCustomers = await db
    .select()
    .from(users)
    .where(inArray(users.id, customerIds));

  // Map customers by ID
  const customersById = allCustomers.reduce((acc, user) => {
    acc[user.id] = user;
    return acc;
  }, {} as Record<string, User>);

  // Combine everything
  return invoiceList.map(invoice => ({
    ...invoice,
    lineItems: lineItemsByInvoice[invoice.id] || [],
    customer: customersById[invoice.customerId] || null,
  }));
}

// ============================================================================
// Invoice Item Operations
// ============================================================================

/**
 * Get all line items for an invoice
 */
export async function getInvoiceItems(invoiceId: string): Promise<InvoiceItem[]> {
  return await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId));
}

/**
 * Alias for getInvoiceItems (for backward compatibility)
 * This method is called in routes.ts but wasn't defined in the original storage.ts
 */
export async function getInvoiceLineItems(invoiceId: string): Promise<InvoiceItem[]> {
  return await getInvoiceItems(invoiceId);
}

/**
 * Create a new invoice line item
 */
export async function createInvoiceItem(item: InsertInvoiceItem): Promise<InvoiceItem> {
  const result = await db.insert(invoiceItems).values(item).returning();
  return result[0];
}

/**
 * Delete all line items for an invoice
 */
export async function deleteInvoiceItems(invoiceId: string): Promise<void> {
  await db.delete(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId));
}

// ============================================================================
// Payment Operations
// ============================================================================

/**
 * Get a single payment by ID
 */
export async function getPayment(id: string): Promise<Payment | undefined> {
  const result = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
  return result[0];
}

/**
 * Get all payments for an invoice
 */
export async function getPaymentsByInvoice(invoiceId: string): Promise<Payment[]> {
  return await db.select().from(payments).where(eq(payments.invoiceId, invoiceId)).orderBy(desc(payments.paymentDate));
}

/**
 * Create a new payment and update invoice payment status
 */
export async function createPayment(payment: InsertPayment): Promise<Payment> {
  const result = await db.insert(payments).values(payment).returning();

  // After creating payment, update invoice paid amount and balance
  if (payment.invoiceId) {
    await updateInvoicePaymentStatus(payment.invoiceId);
  }

  return result[0];
}

/**
 * Update invoice payment status based on all payments
 * Recalculates paid amount, balance, and status
 */
export async function updateInvoicePaymentStatus(invoiceId: string): Promise<void> {
  // Get invoice and all payments
  const invoice = await getInvoice(invoiceId);
  if (!invoice) return;

  const invoicePayments = await getPaymentsByInvoice(invoiceId);

  // Calculate total paid amount
  const totalPaid = invoicePayments.reduce((sum, payment) => {
    return sum + parseFloat(payment.amount);
  }, 0);

  const total = parseFloat(invoice.total);
  const balance = total - totalPaid;

  // Determine new status
  let newStatus = invoice.status;
  if (balance <= 0) {
    newStatus = "paid";
  } else if (totalPaid > 0 && balance > 0) {
    newStatus = "partially_paid";
  } else if (balance > 0 && new Date(invoice.dueDate) < new Date() && invoice.status !== "draft") {
    newStatus = "overdue";
  }

  // Get last payment date
  const lastPaymentDate = invoicePayments.length > 0
    ? invoicePayments[0].paymentDate // Already ordered by desc
    : null;

  // Update invoice
  await db.update(invoices)
    .set({
      paidAmount: totalPaid.toFixed(2),
      balance: balance.toFixed(2),
      lastPaymentDate,
      status: newStatus,
      updatedAt: new Date(),
    })
    .where(eq(invoices.id, invoiceId));
}

/**
 * Generate a new sequential payment number
 * Format: PAY-YYYY-NNNN (e.g., PAY-2025-0001)
 */
export async function generatePaymentNumber(): Promise<string> {
  const year = new Date().getFullYear();

  // Use a simple sequential number for now
  const lastPayment = await db
    .select()
    .from(payments)
    .where(sql`payment_number LIKE ${`PAY-${year}-%`}`)
    .orderBy(desc(payments.createdAt))
    .limit(1);

  let nextNumber = 1;
  if (lastPayment.length > 0 && lastPayment[0].paymentNumber) {
    const match = lastPayment[0].paymentNumber.match(/PAY-\d{4}-(\d+)/);
    if (match) {
      nextNumber = parseInt(match[1]) + 1;
    }
  }

  return `PAY-${year}-${String(nextNumber).padStart(4, '0')}`;
}
