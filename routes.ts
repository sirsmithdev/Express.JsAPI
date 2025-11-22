import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { setupAuth, isAuthenticated } from "./auth";
import { requireRole, requireOwnershipOrRole, getUserId, getAuthenticatedUserId } from "./middleware";
import type { CustomerFilters } from "./storage";
import * as XLSX from "xlsx";
import { sendCampaignEmail } from "./email";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { ObjectPermission, ObjectAccessGroupType } from "./objectAcl";
import {
  jobCards,
  serviceCatalog,
  appointments,
  users,
  vehicleDocuments,
  promotionalBanners,
  invoices,
  paymentGatewaySettings,
  onlinePaymentTransactions,
  insertLeadSchema,
  updateLeadSchema,
  insertLeadActivitySchema,
  insertCustomerTagSchema,
  updateCustomerTagSchema,
  insertCustomerSegmentSchema,
  updateCustomerSegmentSchema,
} from "@shared/schema";
import { eq, and, or, isNull, lte, gte, asc, desc, count } from "drizzle-orm";
import { pushNotificationService } from "./pushNotifications";
import { FirstAtlanticPaymentService } from "./firstAtlanticPayment";
import { QuickBooksService, shouldSync } from "./quickbooksService";
import { generateVehicleCode, generateQRToken } from "./vehicleCodeGenerator";
import QRCode from "qrcode";
import {
  insertAppointmentSchema,
  insertJobCardSchema,
  insertJobCardTaskSchema,
  insertPartSchema, 
  insertVehicleSchema,
  updateVehicleSchema,
  staffUpdateVehicleSchema,
  insertVehicleDocumentSchema,
  updateVehicleDocumentSchema,
  insertApprovalRequestSchema, 
  insertCustomerNoteSchema, 
  insertJobCardTimerSessionSchema,
  insertInvoiceSchema,
  insertInvoiceItemSchema,
  insertPaymentSchema,
  insertEstimateSchema,
  insertEstimateItemSchema,
  updateEstimateSchema,
  insertEmailCampaignSchema,
  insertCouponSchema,
  insertLoyaltyPointsTransactionSchema,
  insertLoyaltySettingsSchema,
  insertCustomerReferralSchema,
  updateAppointmentSchema,
  updateJobCardSchema,
  updateJobCardTaskSchema,
  updatePartSchema,
  updateApprovalSchema,
  updateInvoiceSchema,
  updateEmailCampaignSchema,
  insertUserSchema,
  insertCustomerSchema,
  insertInspectionSchema,
  insertInspectionItemSchema,
  updateInspectionSchema,
  insertStaffReviewSchema,
  insertExpenseSchema,
  updateExpenseSchema,
  insertRentalVehicleSchema,
  updateRentalVehicleSchema,
  insertRentalExtraSchema,
  updateRentalExtraSchema,
  insertRentalReservationSchema,
  updateRentalReservationSchema,
  insertRentalReservationExtraSchema,
  insertRentalContractSchema,
  updateRentalContractSchema,
  insertRentalPaymentSchema,
  insertRentalMaintenanceSchema,
  updateRentalMaintenanceSchema,
  insertRentalAvailabilityBlockSchema,
  insertTowTruckSchema,
  updateTowTruckSchema,
  insertWreckerDriverSchema,
  updateWreckerDriverSchema,
  insertThirdPartyWreckerSchema,
  updateThirdPartyWreckerSchema,
  insertTowPricingZoneSchema,
  updateTowPricingZoneSchema,
  insertTowRequestSchema,
  updateTowRequestSchema,
  insertTowRequestLocationSchema,
  insertChatQuickResponseSchema,
  updateChatQuickResponseSchema,
  insertPromotionalBannerSchema,
  updatePromotionalBannerSchema,
  insertServiceCatalogSchema,
  updateServiceCatalogSchema,
  insertJobCardPartSchema,
  type PricingSettings,
} from "@shared/schema";

export async function registerRoutes(app: Express): Promise<Server> {
  // Setup hybrid authentication (Email/Password + Google OAuth)
  await setupAuth(app);

  // Staff Management
  app.get("/api/staff", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const staff = await storage.getAllStaff();
      // Remove password from response
      const staffWithoutPassword = staff.map(s => ({ ...s, password: undefined }));
      res.json(staffWithoutPassword);
    } catch (error) {
      console.error("Error fetching staff:", error);
      res.status(500).json({ message: "Failed to fetch staff" });
    }
  });

  // Get users with optional role filtering
  app.get("/api/users", isAuthenticated, async (req: any, res) => {
    try {
      const { role } = req.query;
      
      let users;
      
      if (role === "customer") {
        // Get customers
        users = await storage.searchCustomers("", {});
      } else if (role) {
        // Get staff filtered by specific role
        const allStaff = await storage.getAllStaff();
        users = allStaff.filter(s => s.role === role);
      } else {
        // Get all staff if no role specified
        users = await storage.getAllStaff();
      }
      
      // Remove password from response
      const usersWithoutPassword = users.map(u => ({ ...u, password: undefined }));
      res.json(usersWithoutPassword);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.post("/api/staff", isAuthenticated, requireRole(["admin"]), async (req: any, res) => {
    try {
      const validated = insertUserSchema.parse(req.body);
      
      // Ensure role is staff role (not customer)
      if (!validated.role || !["admin", "manager", "mechanic", "receptionist"].includes(validated.role)) {
        return res.status(400).json({ message: "Invalid staff role" });
      }

      const staff = await storage.createUser(validated);
      // Remove password from response
      res.json({ ...staff, password: undefined });
    } catch (error) {
      console.error("Error creating staff:", error);
      res.status(400).json({ message: "Failed to create staff" });
    }
  });

  // Update user role (admin only)
  app.patch("/api/users/:id/role", isAuthenticated, requireRole(["admin"]), async (req: any, res) => {
    try {
      const { role, permissions } = req.body;
      
      // Validate role is one of allowed values
      const allowedRoles = ["admin", "manager", "mechanic", "receptionist", "customer"];
      if (role && !allowedRoles.includes(role)) {
        return res.status(400).json({ message: "Invalid role" });
      }

      const user = await storage.updateUser(req.params.id, { role, permissions });
      // Remove password from response
      res.json({ ...user, password: undefined });
    } catch (error) {
      console.error("Error updating user:", error);
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  // Deactivate staff member (admin only)
  app.patch("/api/staff/:id/deactivate", isAuthenticated, requireRole(["admin"]), async (req: any, res) => {
    try {
      const staffId = req.params.id;
      const currentUserId = getAuthenticatedUserId(req);
      
      // Prevent self-deactivation
      if (staffId === currentUserId) {
        return res.status(400).json({ message: "You cannot deactivate your own account" });
      }
      
      const staff = await storage.getUser(staffId);
      if (!staff) {
        return res.status(404).json({ message: "Staff member not found" });
      }
      
      // Ensure target is staff (not customer)
      if (staff.role === "customer") {
        return res.status(400).json({ message: "Cannot deactivate customer accounts using this endpoint" });
      }
      
      const updated = await storage.updateUser(staffId, { isActive: false });
      res.json({ ...updated, password: undefined });
    } catch (error) {
      console.error("Error deactivating staff:", error);
      res.status(500).json({ message: "Failed to deactivate staff member" });
    }
  });

  // Reactivate staff member (admin only)
  app.patch("/api/staff/:id/reactivate", isAuthenticated, requireRole(["admin"]), async (req: any, res) => {
    try {
      const staffId = req.params.id;
      
      const staff = await storage.getUser(staffId);
      if (!staff) {
        return res.status(404).json({ message: "Staff member not found" });
      }
      
      // Ensure target is staff (not customer)
      if (staff.role === "customer") {
        return res.status(400).json({ message: "Cannot reactivate customer accounts using this endpoint" });
      }
      
      const updated = await storage.updateUser(staffId, { isActive: true });
      res.json({ ...updated, password: undefined });
    } catch (error) {
      console.error("Error reactivating staff:", error);
      res.status(500).json({ message: "Failed to reactivate staff member" });
    }
  });

  // Delete staff member (admin only)
  app.delete("/api/staff/:id", isAuthenticated, requireRole(["admin"]), async (req: any, res) => {
    try {
      const staffId = req.params.id;
      const currentUserId = getAuthenticatedUserId(req);
      
      // Prevent self-deletion
      if (staffId === currentUserId) {
        return res.status(400).json({ message: "You cannot delete your own account" });
      }
      
      const staff = await storage.getUser(staffId);
      if (!staff) {
        return res.status(404).json({ message: "Staff member not found" });
      }
      
      // Ensure target is staff (not customer)
      if (staff.role === "customer") {
        return res.status(400).json({ message: "Cannot delete customer accounts using this endpoint" });
      }
      
      await storage.deleteUser(staffId);
      res.json({ message: "Staff member deleted successfully" });
    } catch (error) {
      console.error("Error deleting staff:", error);
      res.status(500).json({ message: "Failed to delete staff member" });
    }
  });

  // Generate referral codes for existing users (admin only, one-time migration)
  app.post("/api/admin/generate-referral-codes", isAuthenticated, requireRole(["admin"]), async (req: any, res) => {
    try {
      const { generateUniqueReferralCode } = await import("./referralCodeGenerator");

      // Get all users without referral codes
      const users = await storage.getAllUsers();
      const usersWithoutCodes = users.filter(u => !u.referralCode);

      let generated = 0;
      let errors = 0;

      for (const user of usersWithoutCodes) {
        try {
          const referralCode = await generateUniqueReferralCode(user.firstName);
          await storage.updateUserReferralCode(user.id, referralCode);
          generated++;
        } catch (error) {
          console.error(`Failed to generate code for user ${user.id}:`, error);
          errors++;
        }
      }

      res.json({
        message: "Referral code generation complete",
        total: usersWithoutCodes.length,
        generated,
        errors,
      });
    } catch (error) {
      console.error("Error generating referral codes:", error);
      res.status(500).json({ message: "Failed to generate referral codes" });
    }
  });

  // Push Token Management
  app.post("/api/users/push-token", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const { pushToken } = req.body;

      if (!pushToken || typeof pushToken !== 'string') {
        return res.status(400).json({ message: "Push token is required" });
      }

      const updated = await storage.updateUser(userId, { pushToken });
      if (!updated) {
        return res.status(500).json({ message: "Failed to update user" });
      }
      res.json({ message: "Push token registered successfully", pushToken: updated.pushToken });
    } catch (error) {
      console.error("Error registering push token:", error);
      res.status(500).json({ message: "Failed to register push token" });
    }
  });

  app.delete("/api/users/push-token", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      await storage.updateUser(userId, { pushToken: null });
      res.json({ message: "Push token removed successfully" });
    } catch (error) {
      console.error("Error removing push token:", error);
      res.status(500).json({ message: "Failed to remove push token" });
    }
  });

  // Dashboard Statistics
  app.get("/api/dashboard/stats", isAuthenticated, requireRole(["admin", "manager", "mechanic", "receptionist"]), async (req: any, res) => {
    try {
      const stats = await storage.getDashboardStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      res.status(500).json({ message: "Failed to fetch dashboard statistics" });
    }
  });

  // Appointments
  app.get("/api/appointments", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const currentUser = await storage.getUser(userId);
      
      if (currentUser?.role === "customer") {
        const appointments = await storage.getAppointmentsByCustomer(userId);
        res.json(appointments);
      } else {
        const appointments = await storage.getAllAppointments();
        res.json(appointments);
      }
    } catch (error) {
      console.error("Error fetching appointments:", error);
      res.status(500).json({ message: "Failed to fetch appointments" });
    }
  });

  app.post("/api/appointments", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const currentUser = await storage.getUser(userId);
      
      // For customers, customerId is always their own userId (derived from session)
      // For staff, customerId must be provided in request body
      let customerId: string;
      if (currentUser?.role === "customer") {
        customerId = userId; // Derive from session, ignore client value
      } else {
        // Staff can create appointments for any customer
        customerId = req.body.customerId;
        if (!customerId) {
          return res.status(400).json({ message: "customerId is required for staff" });
        }
      }

      // Convert ISO string to Date object for validation
      const appointmentData = {
        ...req.body,
        customerId, // Use server-derived value
        scheduledDate: req.body.scheduledDate ? new Date(req.body.scheduledDate) : undefined,
      };

      const validated = insertAppointmentSchema.parse(appointmentData);
      const appointment = await storage.createAppointment(validated);
      
      // Send push notification to customer
      const customer = await storage.getUser(customerId);
      if (customer) {
        const servicesText = appointment.services && appointment.services.length > 0
          ? appointment.services.join(", ")
          : appointment.serviceType;
        const appointmentTypeText = appointment.appointmentType === "remote" ? "Remote" : "In-Shop";

        const notification = pushNotificationService.createAppointmentNotification(
          'created',
          {
            serviceType: servicesText,
            scheduledDate: appointment.scheduledDate,
          }
        );
        pushNotificationService.sendToUser(customer, notification).catch(err => {
          console.error('Failed to send appointment notification:', err);
        });
      }

      // Send push notification to admin/managers about new appointment
      const staff = await storage.getAllStaff();
      const adminManagers = staff.filter(s =>
        (s.role === 'admin' || s.role === 'manager') && s.isActive
      );
      if (adminManagers.length > 0) {
        const servicesText = appointment.services && appointment.services.length > 0
          ? appointment.services.join(", ")
          : appointment.serviceType;
        const appointmentTypeText = appointment.appointmentType === "remote" ? "Remote" : "In-Shop";

        const staffNotification = {
          title: 'New Appointment',
          body: `New ${appointmentTypeText} appointment for ${servicesText} scheduled for ${appointment.scheduledDate.toLocaleString()}`,
          data: { type: 'appointment', action: 'new' },
          channelId: 'appointments',
        };
        pushNotificationService.sendToMultipleUsers(adminManagers, staffNotification).catch(err => {
          console.error('Failed to send appointment notification to staff:', err);
        });
      }
      
      res.json(appointment);
    } catch (error) {
      console.error("Error creating appointment:", error);
      res.status(400).json({ message: "Failed to create appointment" });
    }
  });

  app.patch("/api/appointments/:id", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req: any, res) => {
    try {
      // Convert ISO string to Date object for scheduledDate if present
      const updateData = {
        ...req.body,
        scheduledDate: req.body.scheduledDate ? new Date(req.body.scheduledDate) : undefined,
      };

      const validated = updateAppointmentSchema.parse(updateData);
      const appointment = await storage.updateAppointment(req.params.id, validated);
      if (!appointment) {
        return res.status(404).json({ message: "Appointment not found" });
      }
      
      // Get original appointment to check status change
      const originalAppointment = await storage.getAppointment(req.params.id);
      
      // Send push notification if status changed to confirmed
      if (validated.status === 'confirmed' && originalAppointment?.status !== 'confirmed') {
        const customer = await storage.getUser(appointment.customerId);
        if (customer) {
          const servicesText = appointment.services && appointment.services.length > 0
            ? appointment.services.join(", ")
            : appointment.serviceType;

          const notification = pushNotificationService.createAppointmentNotification(
            'confirmed',
            {
              serviceType: servicesText,
              scheduledDate: appointment.scheduledDate,
            }
          );
          pushNotificationService.sendToUser(customer, notification).catch(err => {
            console.error('Failed to send appointment confirmation notification:', err);
          });
        }
      }

      // Send push notification if status changed to cancelled
      if (validated.status === 'cancelled' && originalAppointment?.status !== 'cancelled') {
        const customer = await storage.getUser(appointment.customerId);
        if (customer) {
          const servicesText = appointment.services && appointment.services.length > 0
            ? appointment.services.join(", ")
            : appointment.serviceType;

          const notification = pushNotificationService.createAppointmentNotification(
            'cancelled',
            {
              serviceType: servicesText,
              scheduledDate: appointment.scheduledDate,
            }
          );
          pushNotificationService.sendToUser(customer, notification).catch(err => {
            console.error('Failed to send appointment cancellation notification:', err);
          });
        }
      }
      
      res.json(appointment);
    } catch (error) {
      console.error("Error updating appointment:", error);
      res.status(400).json({ message: "Failed to update appointment" });
    }
  });

  app.patch("/api/appointments/:id/cancel", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const currentUser = await storage.getUser(userId);
      const appointment = await storage.getAppointment(req.params.id);

      if (!appointment) {
        return res.status(404).json({ message: "Appointment not found" });
      }

      // Customers can only cancel their own appointments
      if (currentUser?.role === "customer" && appointment.customerId !== userId) {
        return res.status(403).json({ message: "Forbidden: Cannot cancel another customer's appointment" });
      }

      const updated = await storage.updateAppointment(req.params.id, { status: "cancelled" });
      if (!updated) {
        return res.status(404).json({ message: "Appointment not found" });
      }
      
      // Send push notification to customer
      const customer = await storage.getUser(updated.customerId);
      if (customer) {
        const notification = pushNotificationService.createAppointmentNotification(
          'cancelled',
          {
            serviceType: updated.serviceType,
            scheduledDate: updated.scheduledDate,
          }
        );
        pushNotificationService.sendToUser(customer, notification).catch(err => {
          console.error('Failed to send appointment cancellation notification:', err);
        });
      }
      
      res.json(updated);
    } catch (error) {
      console.error("Error cancelling appointment:", error);
      res.status(500).json({ message: "Failed to cancel appointment" });
    }
  });

  app.post("/api/appointments/:id/convert-to-job-card", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req: any, res) => {
    try {
      const appointment = await storage.getAppointment(req.params.id);

      if (!appointment) {
        return res.status(404).json({ message: "Appointment not found" });
      }

      // Check if appointment is in a valid state for conversion
      if (appointment.status === "cancelled") {
        return res.status(400).json({ message: "Cannot convert cancelled appointment to job card" });
      }

      // Check if appointment has already been converted
      const existingJobCard = await db.select()
        .from(jobCards)
        .where(eq(jobCards.appointmentId, req.params.id))
        .limit(1);

      if (existingJobCard.length > 0) {
        return res.status(400).json({
          message: "Appointment has already been converted to a job card",
          jobCardId: existingJobCard[0].id
        });
      }

      const jobCard = await storage.convertAppointmentToJobCard(req.params.id);

      res.json(jobCard);
    } catch (error) {
      console.error("Error converting appointment to job card:", error);
      res.status(500).json({ message: "Failed to convert appointment to job card" });
    }
  });

  // Service Reminders
  app.get("/api/service-reminders", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const { status, type } = req.query;
      const reminders = await storage.getServiceReminders({
        status: status as string | undefined,
        type: type as string | undefined,
      });
      res.json(reminders);
    } catch (error) {
      console.error("Error fetching service reminders:", error);
      res.status(500).json({ message: "Failed to fetch service reminders" });
    }
  });

  app.post("/api/service-reminders", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const reminderData = {
        ...req.body,
        createdBy: userId,
        scheduledDate: req.body.scheduledDate ? new Date(req.body.scheduledDate) : undefined,
      };

      const reminder = await storage.createServiceReminder(reminderData);
      res.json(reminder);
    } catch (error) {
      console.error("Error creating service reminder:", error);
      res.status(400).json({ message: "Failed to create service reminder" });
    }
  });

  app.patch("/api/service-reminders/:id", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const updateData = {
        ...req.body,
        scheduledDate: req.body.scheduledDate ? new Date(req.body.scheduledDate) : undefined,
      };

      const reminder = await storage.updateServiceReminder(req.params.id, updateData);
      res.json(reminder);
    } catch (error) {
      console.error("Error updating service reminder:", error);
      res.status(400).json({ message: "Failed to update service reminder" });
    }
  });

  app.delete("/api/service-reminders/:id", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      await storage.deleteServiceReminder(req.params.id);
      res.json({ message: "Service reminder deleted successfully" });
    } catch (error) {
      console.error("Error deleting service reminder:", error);
      res.status(500).json({ message: "Failed to delete service reminder" });
    }
  });

  app.post("/api/service-reminders/:id/send-now", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const { serviceReminderService } = await import("./serviceReminders");
      await serviceReminderService.sendManualReminder(req.params.id);
      res.json({ message: "Reminder sent successfully" });
    } catch (error) {
      console.error("Error sending reminder:", error);
      res.status(500).json({ message: "Failed to send reminder" });
    }
  });

  app.get("/api/service-reminders/history", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const { reminderId, customerId, startDate, endDate } = req.query;
      const history = await storage.getReminderHistory({
        reminderId: reminderId as string | undefined,
        customerId: customerId as string | undefined,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
      });
      res.json(history);
    } catch (error) {
      console.error("Error fetching reminder history:", error);
      res.status(500).json({ message: "Failed to fetch reminder history" });
    }
  });

  // Maintenance Schedules
  app.get("/api/maintenance-schedules", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const currentUser = await storage.getUser(userId);
      const { vehicleId, overdue, dueSoon, daysAhead } = req.query;

      if (vehicleId) {
        const schedules = await storage.getVehicleMaintenanceSchedules(vehicleId as string);
        res.json(schedules);
      } else if (currentUser?.role === "customer") {
        // Customers can only see their own vehicles' schedules
        const vehicles = await storage.getVehiclesByCustomer(userId);
        const allSchedules = [];
        for (const vehicle of vehicles) {
          const schedules = await storage.getVehicleMaintenanceSchedules(vehicle.id);
          allSchedules.push(...schedules);
        }
        res.json(allSchedules);
      } else {
        // Staff can see all schedules with filters
        const schedules = await storage.getAllMaintenanceSchedules({
          overdue: overdue === "true",
          dueSoon: dueSoon === "true",
          daysAhead: daysAhead ? parseInt(daysAhead as string) : undefined,
        });
        res.json(schedules);
      }
    } catch (error) {
      console.error("Error fetching maintenance schedules:", error);
      res.status(500).json({ message: "Failed to fetch maintenance schedules" });
    }
  });

  app.post("/api/maintenance-schedules", isAuthenticated, requireRole(["admin", "manager", "mechanic"]), async (req: any, res) => {
    try {
      const scheduleData = {
        ...req.body,
        lastServiceDate: req.body.lastServiceDate ? new Date(req.body.lastServiceDate) : undefined,
        nextServiceDueDate: req.body.nextServiceDueDate ? new Date(req.body.nextServiceDueDate) : undefined,
      };

      const schedule = await storage.createMaintenanceSchedule(scheduleData);
      res.json(schedule);
    } catch (error) {
      console.error("Error creating maintenance schedule:", error);
      res.status(400).json({ message: "Failed to create maintenance schedule" });
    }
  });

  app.patch("/api/maintenance-schedules/:id", isAuthenticated, requireRole(["admin", "manager", "mechanic"]), async (req: any, res) => {
    try {
      const updateData = {
        ...req.body,
        lastServiceDate: req.body.lastServiceDate ? new Date(req.body.lastServiceDate) : undefined,
        nextServiceDueDate: req.body.nextServiceDueDate ? new Date(req.body.nextServiceDueDate) : undefined,
      };

      const schedule = await storage.updateMaintenanceSchedule(req.params.id, updateData);
      res.json(schedule);
    } catch (error) {
      console.error("Error updating maintenance schedule:", error);
      res.status(400).json({ message: "Failed to update maintenance schedule" });
    }
  });

  app.delete("/api/maintenance-schedules/:id", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      await storage.deleteMaintenanceSchedule(req.params.id);
      res.json({ message: "Maintenance schedule deleted successfully" });
    } catch (error) {
      console.error("Error deleting maintenance schedule:", error);
      res.status(500).json({ message: "Failed to delete maintenance schedule" });
    }
  });

  app.patch("/api/vehicles/:id/mileage", isAuthenticated, async (req: any, res) => {
    try {
      const { mileage } = req.body;
      if (typeof mileage !== "number" || mileage < 0) {
        return res.status(400).json({ message: "Invalid mileage value" });
      }

      const vehicle = await storage.updateVehicleMileage(req.params.id, mileage);
      res.json(vehicle);
    } catch (error) {
      console.error("Error updating vehicle mileage:", error);
      res.status(500).json({ message: "Failed to update vehicle mileage" });
    }
  });

  // Chat Settings
  app.get("/api/chat-settings", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const settings = await storage.getChatSettings();
      res.json(settings);
    } catch (error) {
      console.error("Error fetching chat settings:", error);
      res.status(500).json({ message: "Failed to fetch chat settings" });
    }
  });

  app.patch("/api/chat-settings", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const settings = await storage.updateChatSettings(req.body);
      res.json(settings);
    } catch (error) {
      console.error("Error updating chat settings:", error);
      res.status(400).json({ message: "Failed to update chat settings" });
    }
  });

  // Appointment Settings
  app.get("/api/settings/appointments", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const settings = await storage.getAppointmentSettings();
      res.json(settings);
    } catch (error) {
      console.error("Error fetching appointment settings:", error);
      res.status(500).json({ message: "Failed to fetch appointment settings" });
    }
  });

  app.patch("/api/settings/appointments", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const settings = await storage.updateAppointmentSettings(req.body);
      res.json(settings);
    } catch (error) {
      console.error("Error updating appointment settings:", error);
      res.status(400).json({ message: "Failed to update appointment settings" });
    }
  });

  // Payment Gateway Settings
  app.get("/api/settings/payment-gateway", isAuthenticated, requireRole(["admin"]), async (req: any, res) => {
    try {
      const settings = await storage.getPaymentGatewaySettings();
      res.json(settings);
    } catch (error) {
      console.error("Error fetching payment gateway settings:", error);
      res.status(500).json({ message: "Failed to fetch payment gateway settings" });
    }
  });

  app.patch("/api/settings/payment-gateway", isAuthenticated, requireRole(["admin"]), async (req: any, res) => {
    try {
      const settings = await storage.updatePaymentGatewaySettings(req.body);
      res.json(settings);
    } catch (error) {
      console.error("Error updating payment gateway settings:", error);
      res.status(400).json({ message: "Failed to update payment gateway settings" });
    }
  });

  // QuickBooks Integration Settings
  app.get("/api/settings/quickbooks", isAuthenticated, requireRole(["admin"]), async (req: any, res) => {
    try {
      const settings = await storage.getQuickBooksSettings();
      res.json(settings);
    } catch (error) {
      console.error("Error fetching QuickBooks settings:", error);
      res.status(500).json({ message: "Failed to fetch QuickBooks settings" });
    }
  });

  app.patch("/api/settings/quickbooks", isAuthenticated, requireRole(["admin"]), async (req: any, res) => {
    try {
      const settings = await storage.updateQuickBooksSettings(req.body);
      res.json(settings);
    } catch (error) {
      console.error("Error updating QuickBooks settings:", error);
      res.status(400).json({ message: "Failed to update QuickBooks settings" });
    }
  });

  // QuickBooks OAuth and Sync
  app.get("/api/quickbooks/auth-url", isAuthenticated, requireRole(["admin"]), async (req: any, res) => {
    try {
      const settings = await storage.getQuickBooksSettings();

      if (!settings.enabled) {
        return res.status(400).json({ message: "QuickBooks integration is not enabled" });
      }

      if (!settings.clientId) {
        return res.status(400).json({ message: "QuickBooks client ID not configured" });
      }

      const qbService = new QuickBooksService(settings);
      const baseUrl = req.protocol + "://" + req.get("host");
      const redirectUri = `${baseUrl}/api/quickbooks/callback`;
      const state = Math.random().toString(36).substring(7); // Generate random state

      // Store state in session for verification (in production, use proper session storage)
      req.session = req.session || {};
      req.session.qbOAuthState = state;

      const authUrl = qbService.getAuthorizationUrl(redirectUri, state);
      res.json({ authUrl });
    } catch (error: any) {
      console.error("Error generating QuickBooks auth URL:", error);
      res.status(500).json({ message: error.message || "Failed to generate authorization URL" });
    }
  });

  app.get("/api/quickbooks/callback", async (req: any, res) => {
    try {
      const { code, state, realmId } = req.query;

      if (!code || !realmId) {
        return res.status(400).send("<html><body><h1>OAuth Error</h1><p>Missing authorization code or realm ID</p></body></html>");
      }

      // Verify state (in production, check against stored session state)
      // if (state !== req.session?.qbOAuthState) {
      //   return res.status(400).send("<html><body><h1>OAuth Error</h1><p>Invalid state parameter</p></body></html>");
      // }

      const settings = await storage.getQuickBooksSettings();
      const qbService = new QuickBooksService(settings);

      const baseUrl = req.protocol + "://" + req.get("host");
      const redirectUri = `${baseUrl}/api/quickbooks/callback`;

      // Exchange code for tokens
      const tokens = await qbService.exchangeCodeForToken(code as string, redirectUri);

      // Calculate token expiration
      const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);

      // Update settings with tokens
      await storage.updateQuickBooksSettings({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiresAt: expiresAt,
        realmId: realmId as string,
      });

      // Test connection
      const updatedSettings = await storage.getQuickBooksSettings();
      const testService = new QuickBooksService(updatedSettings);
      const isConnected = await testService.testConnection();

      if (isConnected) {
        res.send(`
          <html>
            <body>
              <h1>QuickBooks Connected Successfully!</h1>
              <p>Your QuickBooks account has been connected.</p>
              <p>You can now close this window and return to the settings page.</p>
              <script>
                setTimeout(function() {
                  window.close();
                }, 3000);
              </script>
            </body>
          </html>
        `);
      } else {
        res.send(`
          <html>
            <body>
              <h1>Connection Test Failed</h1>
              <p>Authentication completed but connection test failed.</p>
              <p>Please check your settings and try again.</p>
            </body>
          </html>
        `);
      }
    } catch (error: any) {
      console.error("Error in QuickBooks OAuth callback:", error);
      res.status(500).send(`<html><body><h1>OAuth Error</h1><p>${error.message}</p></body></html>`);
    }
  });

  app.post("/api/quickbooks/refresh-token", isAuthenticated, requireRole(["admin"]), async (req: any, res) => {
    try {
      const settings = await storage.getQuickBooksSettings();

      if (!settings.enabled) {
        return res.status(400).json({ message: "QuickBooks integration is not enabled" });
      }

      const qbService = new QuickBooksService(settings);
      const tokens = await qbService.refreshAccessToken();

      const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);

      await storage.updateQuickBooksSettings({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiresAt: expiresAt,
      });

      res.json({ message: "Token refreshed successfully", expiresAt });
    } catch (error: any) {
      console.error("Error refreshing QuickBooks token:", error);
      res.status(500).json({ message: error.message || "Failed to refresh token" });
    }
  });

  app.post("/api/quickbooks/test-connection", isAuthenticated, requireRole(["admin"]), async (req: any, res) => {
    try {
      const settings = await storage.getQuickBooksSettings();

      if (!settings.enabled) {
        return res.status(400).json({ message: "QuickBooks integration is not enabled" });
      }

      if (!settings.accessToken) {
        return res.status(400).json({ message: "QuickBooks not authenticated" });
      }

      const qbService = new QuickBooksService(settings);

      // Check if token needs refresh
      if (qbService.isTokenExpired()) {
        const tokens = await qbService.refreshAccessToken();
        const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);

        await storage.updateQuickBooksSettings({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          tokenExpiresAt: expiresAt,
        });

        // Create new service instance with refreshed token
        const updatedSettings = await storage.getQuickBooksSettings();
        const refreshedService = new QuickBooksService(updatedSettings);
        const companyInfo = await refreshedService.getCompanyInfo();

        res.json({
          connected: true,
          companyInfo,
          tokenRefreshed: true,
        });
      } else {
        const companyInfo = await qbService.getCompanyInfo();
        res.json({
          connected: true,
          companyInfo,
          tokenRefreshed: false,
        });
      }
    } catch (error: any) {
      console.error("Error testing QuickBooks connection:", error);
      res.status(500).json({
        connected: false,
        error: error.message || "Connection test failed"
      });
    }
  });

  app.post("/api/quickbooks/sync", isAuthenticated, requireRole(["admin"]), async (req: any, res) => {
    try {
      const settings = await storage.getQuickBooksSettings();

      if (!settings.enabled) {
        return res.status(400).json({ message: "QuickBooks integration is not enabled" });
      }

      if (!settings.accessToken) {
        return res.status(400).json({ message: "QuickBooks not authenticated" });
      }

      // Update sync status to in_progress
      await storage.updateQuickBooksSettings({
        lastSyncStatus: "in_progress",
        lastSyncError: null,
      });

      const qbService = new QuickBooksService(settings);

      // Check if token needs refresh
      if (qbService.isTokenExpired()) {
        const tokens = await qbService.refreshAccessToken();
        const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);

        await storage.updateQuickBooksSettings({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          tokenExpiresAt: expiresAt,
        });
      }

      const syncResults = {
        customers: 0,
        invoices: 0,
        payments: 0,
        expenses: 0,
        errors: [] as string[],
      };

      try {
        // Sync customers (if enabled)
        if (settings.syncCustomers) {
          const customers = await storage.getAllCustomers({ limit: 100, offset: 0 });
          for (const customer of customers.data) {
            try {
              await qbService.syncCustomer({
                id: customer.id,
                firstName: customer.firstName || "",
                lastName: customer.lastName || "",
                email: customer.email,
                phone: customer.phone || undefined,
              });
              syncResults.customers++;
            } catch (error: any) {
              syncResults.errors.push(`Customer ${customer.id}: ${error.message}`);
            }
          }
        }

        // Sync invoices (if enabled)
        if (settings.syncInvoices) {
          const invoices = await storage.getAllInvoices({ limit: 100 });
          for (const invoice of invoices) {
            try {
              // Get invoice line items
              const lineItems = await storage.getInvoiceLineItems(invoice.id);
              const customer = await storage.getUserById(invoice.customerId);

              await qbService.syncInvoice({
                id: invoice.id,
                invoiceNumber: invoice.invoiceNumber,
                customerId: invoice.customerId,
                customerName: customer ? `${customer.firstName} ${customer.lastName}` : "Unknown",
                total: invoice.total,
                tax: invoice.tax || "0",
                issueDate: new Date(invoice.issueDate),
                dueDate: invoice.dueDate ? new Date(invoice.dueDate) : undefined,
                lineItems: lineItems.map(item => ({
                  description: item.description || "",
                  quantity: item.quantity || 1,
                  unitPrice: item.unitPrice,
                  amount: item.total,
                })),
              });
              syncResults.invoices++;
            } catch (error: any) {
              syncResults.errors.push(`Invoice ${invoice.invoiceNumber}: ${error.message}`);
            }
          }
        }

        // Sync payments (if enabled)
        if (settings.syncPayments) {
          const payments = await storage.getAllPayments();
          for (const payment of payments) {
            try {
              await qbService.syncPayment({
                id: payment.id,
                invoiceId: payment.invoiceId,
                amount: payment.amount,
                paymentDate: new Date(payment.paymentDate),
                paymentMethod: payment.paymentMethod,
                transactionId: payment.transactionId || undefined,
              });
              syncResults.payments++;
            } catch (error: any) {
              syncResults.errors.push(`Payment ${payment.id}: ${error.message}`);
            }
          }
        }

        // Sync expenses (if enabled)
        if (settings.syncExpenses) {
          const expenses = await storage.getAllExpenses({ limit: 100 });
          for (const expense of expenses) {
            try {
              await qbService.syncExpense({
                id: expense.id,
                amount: expense.amount,
                expenseDate: new Date(expense.expenseDate),
                category: expense.category,
                description: expense.description || undefined,
                vendor: expense.vendor || undefined,
              });
              syncResults.expenses++;
            } catch (error: any) {
              syncResults.errors.push(`Expense ${expense.id}: ${error.message}`);
            }
          }
        }

        // Update sync status
        await storage.updateQuickBooksSettings({
          lastSyncAt: new Date(),
          lastSyncStatus: syncResults.errors.length > 0 ? "error" : "success",
          lastSyncError: syncResults.errors.length > 0 ? syncResults.errors.join("; ") : null,
        });

        res.json({
          success: true,
          results: syncResults,
          message: `Synced ${syncResults.customers} customers, ${syncResults.invoices} invoices, ${syncResults.payments} payments, ${syncResults.expenses} expenses`,
        });
      } catch (error: any) {
        // Update sync status with error
        await storage.updateQuickBooksSettings({
          lastSyncAt: new Date(),
          lastSyncStatus: "error",
          lastSyncError: error.message,
        });

        throw error;
      }
    } catch (error: any) {
      console.error("Error syncing with QuickBooks:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Sync failed"
      });
    }
  });

  app.post("/api/quickbooks/disconnect", isAuthenticated, requireRole(["admin"]), async (req: any, res) => {
    try {
      await storage.updateQuickBooksSettings({
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
        realmId: null,
        lastSyncAt: null,
        lastSyncStatus: null,
        lastSyncError: null,
      });

      res.json({ message: "QuickBooks disconnected successfully" });
    } catch (error) {
      console.error("Error disconnecting QuickBooks:", error);
      res.status(500).json({ message: "Failed to disconnect QuickBooks" });
    }
  });

  // ============================================================
  // PERMISSIONS & ROLES MANAGEMENT
  // ============================================================

  // Get all permissions (grouped by category)
  app.get("/api/permissions", isAuthenticated, requireRole(["admin"]), async (req: any, res) => {
    try {
      const allPermissions = await storage.getAllPermissions();

      // Group by category for easier UI consumption
      const grouped = allPermissions.reduce((acc: any, perm) => {
        if (!acc[perm.category]) {
          acc[perm.category] = [];
        }
        acc[perm.category].push(perm);
        return acc;
      }, {});

      res.json({ permissions: allPermissions, grouped });
    } catch (error) {
      console.error("Error fetching permissions:", error);
      res.status(500).json({ message: "Failed to fetch permissions" });
    }
  });

  // Get all roles
  app.get("/api/roles", isAuthenticated, requireRole(["admin"]), async (req: any, res) => {
    try {
      const roles = await storage.getAllRoles();
      res.json(roles);
    } catch (error) {
      console.error("Error fetching roles:", error);
      res.status(500).json({ message: "Failed to fetch roles" });
    }
  });

  // Get active roles (for dropdowns)
  app.get("/api/roles/active", isAuthenticated, requireRole(["admin"]), async (req: any, res) => {
    try {
      const roles = await storage.getActiveRoles();
      res.json(roles);
    } catch (error) {
      console.error("Error fetching active roles:", error);
      res.status(500).json({ message: "Failed to fetch active roles" });
    }
  });

  // Get role by ID with permissions
  app.get("/api/roles/:id", isAuthenticated, requireRole(["admin"]), async (req: any, res) => {
    try {
      const role = await storage.getRoleById(req.params.id);
      if (!role) {
        return res.status(404).json({ message: "Role not found" });
      }

      const rolePermissions = await storage.getRolePermissions(req.params.id);
      res.json({ ...role, permissions: rolePermissions });
    } catch (error) {
      console.error("Error fetching role:", error);
      res.status(500).json({ message: "Failed to fetch role" });
    }
  });

  // Create custom role
  app.post("/api/roles", isAuthenticated, requireRole(["admin"]), async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const { name, description, permissionIds } = req.body;

      if (!name || !description) {
        return res.status(400).json({ message: "Name and description are required" });
      }

      // Check if role name already exists
      const existing = await storage.getRoleByName(name);
      if (existing) {
        return res.status(400).json({ message: "Role name already exists" });
      }

      // Create role
      const newRole = await storage.createRole({
        name,
        description,
        isSystem: false, // Custom roles are never system roles
        isActive: true,
        createdBy: userId,
        updatedBy: userId,
      });

      // Assign permissions if provided
      if (permissionIds && Array.isArray(permissionIds) && permissionIds.length > 0) {
        await storage.bulkAddRolePermissions(newRole.id, permissionIds, userId);
      }

      // Log audit trail
      await storage.createPermissionAuditLog({
        action: "role_created",
        performedBy: userId,
        roleId: newRole.id,
        roleName: newRole.name,
        details: { description, permissionCount: permissionIds?.length || 0 },
      });

      res.status(201).json(newRole);
    } catch (error) {
      console.error("Error creating role:", error);
      res.status(400).json({ message: "Failed to create role" });
    }
  });

  // Update role
  app.patch("/api/roles/:id", isAuthenticated, requireRole(["admin"]), async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const { name, description, isActive, permissionIds } = req.body;

      // Check if role exists
      const existingRole = await storage.getRoleById(req.params.id);
      if (!existingRole) {
        return res.status(404).json({ message: "Role not found" });
      }

      // Prepare update data
      const updateData: any = {
        updatedBy: userId,
        updatedAt: new Date(),
      };

      if (name !== undefined) {
        // Check if new name conflicts with existing role
        const nameConflict = await storage.getRoleByName(name);
        if (nameConflict && nameConflict.id !== req.params.id) {
          return res.status(400).json({ message: "Role name already exists" });
        }
        updateData.name = name;
      }

      if (description !== undefined) updateData.description = description;
      if (isActive !== undefined) updateData.isActive = isActive;

      // Update role basic info
      const updatedRole = await storage.updateRole(req.params.id, updateData);

      // Update permissions if provided
      if (permissionIds && Array.isArray(permissionIds)) {
        await storage.setRolePermissions(req.params.id, permissionIds, userId);
      }

      // Log audit trail
      await storage.createPermissionAuditLog({
        action: "role_updated",
        performedBy: userId,
        roleId: req.params.id,
        roleName: updatedRole.name,
        details: { changes: updateData, permissionCount: permissionIds?.length },
      });

      res.json(updatedRole);
    } catch (error) {
      console.error("Error updating role:", error);
      res.status(400).json({ message: "Failed to update role" });
    }
  });

  // Delete role (soft delete - deactivate)
  app.delete("/api/roles/:id", isAuthenticated, requireRole(["admin"]), async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);

      // Check if role exists
      const existingRole = await storage.getRoleById(req.params.id);
      if (!existingRole) {
        return res.status(404).json({ message: "Role not found" });
      }

      // Prevent deletion of system roles if they're in use
      if (existingRole.isSystem) {
        const userCount = await storage.countUsersWithRole(existingRole.name);
        if (userCount > 0) {
          return res.status(400).json({
            message: `Cannot delete system role "${existingRole.name}" - ${userCount} users are assigned to this role`,
          });
        }
      }

      // Deactivate role instead of hard delete
      await storage.updateRole(req.params.id, {
        isActive: false,
        updatedBy: userId,
        updatedAt: new Date(),
      });

      // Log audit trail
      await storage.createPermissionAuditLog({
        action: "role_deleted",
        performedBy: userId,
        roleId: req.params.id,
        roleName: existingRole.name,
        details: { deactivated: true },
      });

      res.json({ message: "Role deactivated successfully" });
    } catch (error) {
      console.error("Error deleting role:", error);
      res.status(400).json({ message: "Failed to delete role" });
    }
  });

  // Get user permissions (for current user or specific user)
  app.get("/api/users/:userId/permissions", isAuthenticated, async (req: any, res) => {
    try {
      const currentUserId = getAuthenticatedUserId(req);
      const targetUserId = req.params.userId;

      // Only admins can view other users' permissions
      if (currentUserId !== targetUserId) {
        const currentUser = await storage.getUser(currentUserId);
        if (!currentUser || currentUser.role !== "admin") {
          return res.status(403).json({ message: "Access denied" });
        }
      }

      const user = await storage.getUser(targetUserId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Import permission service dynamically
      const { getUserPermissions } = await import("./permissionService");
      const permissions = await getUserPermissions(targetUserId);

      // Get user overrides for context
      const overrides = await storage.getUserPermissionOverrides(targetUserId);

      res.json({
        userId: targetUserId,
        role: user.role,
        effectivePermissions: Array.from(permissions),
        overrides,
      });
    } catch (error) {
      console.error("Error fetching user permissions:", error);
      res.status(500).json({ message: "Failed to fetch user permissions" });
    }
  });

  // Grant permission to user (override)
  app.post("/api/users/:userId/permissions", isAuthenticated, requireRole(["admin"]), async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const targetUserId = req.params.userId;
      const { permissionCode, reason, expiresAt } = req.body;

      if (!permissionCode) {
        return res.status(400).json({ message: "Permission code is required" });
      }

      // Check if target user exists
      const targetUser = await storage.getUser(targetUserId);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }

      // Import permission service
      const { grantPermission } = await import("./permissionService");

      // Grant permission
      await grantPermission(
        targetUserId,
        permissionCode,
        userId,
        reason,
        expiresAt ? new Date(expiresAt) : undefined
      );

      // Log audit trail
      await storage.createPermissionAuditLog({
        action: "permission_granted",
        performedBy: userId,
        targetUserId,
        targetUserEmail: targetUser.email,
        permissionCode,
        details: { reason, expiresAt },
      });

      res.json({ message: "Permission granted successfully" });
    } catch (error: any) {
      console.error("Error granting permission:", error);
      res.status(400).json({ message: error.message || "Failed to grant permission" });
    }
  });

  // Revoke permission from user (override)
  app.delete("/api/users/:userId/permissions/:permissionCode", isAuthenticated, requireRole(["admin"]), async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const targetUserId = req.params.userId;
      const permissionCode = req.params.permissionCode;
      const { reason } = req.body;

      // Check if target user exists
      const targetUser = await storage.getUser(targetUserId);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }

      // Import permission service
      const { revokePermission } = await import("./permissionService");

      // Revoke permission
      await revokePermission(targetUserId, permissionCode, userId, reason);

      // Log audit trail
      await storage.createPermissionAuditLog({
        action: "permission_revoked",
        performedBy: userId,
        targetUserId,
        targetUserEmail: targetUser.email,
        permissionCode,
        details: { reason },
      });

      res.json({ message: "Permission revoked successfully" });
    } catch (error: any) {
      console.error("Error revoking permission:", error);
      res.status(400).json({ message: error.message || "Failed to revoke permission" });
    }
  });

  // Remove permission override (reset to role default)
  app.post("/api/users/:userId/permissions/:permissionCode/reset", isAuthenticated, requireRole(["admin"]), async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const targetUserId = req.params.userId;
      const permissionCode = req.params.permissionCode;

      // Check if target user exists
      const targetUser = await storage.getUser(targetUserId);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }

      // Import permission service
      const { removePermissionOverride } = await import("./permissionService");

      // Remove override
      await removePermissionOverride(targetUserId, permissionCode);

      // Log audit trail
      await storage.createPermissionAuditLog({
        action: "permission_override_removed",
        performedBy: userId,
        targetUserId,
        targetUserEmail: targetUser.email,
        permissionCode,
        details: { reset: true },
      });

      res.json({ message: "Permission override removed successfully" });
    } catch (error: any) {
      console.error("Error removing permission override:", error);
      res.status(400).json({ message: error.message || "Failed to remove permission override" });
    }
  });

  // Get permission audit logs
  app.get("/api/permissions/audit-logs", isAuthenticated, requireRole(["admin"]), async (req: any, res) => {
    try {
      const { action, userId, roleId, limit = 100 } = req.query;

      let logs;
      if (userId) {
        logs = await storage.getUserAuditLogs(userId as string, parseInt(limit as string));
      } else if (roleId) {
        logs = await storage.getRoleAuditLogs(roleId as string, parseInt(limit as string));
      } else {
        logs = await storage.getPermissionAuditLogs(
          action ? (action as string) : undefined,
          parseInt(limit as string)
        );
      }

      res.json(logs);
    } catch (error) {
      console.error("Error fetching audit logs:", error);
      res.status(500).json({ message: "Failed to fetch audit logs" });
    }
  });

  // First Atlantic Payment Processing
  app.post("/api/payments/first-atlantic/initiate", isAuthenticated, async (req: any, res) => {
    try {
      const { invoiceId } = req.body;

      if (!invoiceId) {
        return res.status(400).json({ message: "Invoice ID is required" });
      }

      // Get invoice details
      const invoice = await storage.getInvoiceById(invoiceId);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      // Check if user has access to this invoice
      const userId = getUserId(req);
      if (invoice.customerId !== userId && !["admin", "manager", "receptionist"].includes(req.user.role)) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Check if invoice is already paid
      if (invoice.status === "paid") {
        return res.status(400).json({ message: "Invoice is already paid" });
      }

      // Get payment gateway settings
      const gatewaySettings = await storage.getPaymentGatewaySettings();
      if (!gatewaySettings.firstAtlanticEnabled) {
        return res.status(400).json({ message: "First Atlantic payment gateway is not enabled" });
      }

      // Calculate amount to pay (total - amountPaid)
      const amountDue = parseFloat(invoice.total) - parseFloat(invoice.amountPaid || "0");
      if (amountDue <= 0) {
        return res.status(400).json({ message: "Invoice has no outstanding balance" });
      }

      // Create payment transaction record
      const customer = await storage.getUserById(invoice.customerId);
      const paymentTransaction = await storage.createPaymentTransaction({
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        amount: amountDue.toString(),
        currency: gatewaySettings.firstAtlanticCurrency || "USD",
        gateway: "first_atlantic",
        status: "pending",
        customerEmail: customer?.email,
        customerName: customer ? `${customer.firstName} ${customer.lastName}` : undefined,
      });

      // Generate payment form data
      const paymentService = new FirstAtlanticPaymentService(gatewaySettings);
      const baseUrl = req.protocol + "://" + req.get("host");
      const paymentFormData = paymentService.generatePaymentForm({
        transactionId: paymentTransaction.id,
        amount: amountDue,
        currency: gatewaySettings.firstAtlanticCurrency || "USD",
        orderNumber: invoice.invoiceNumber,
        customerName: customer ? `${customer.firstName} ${customer.lastName}` : undefined,
        customerEmail: customer?.email,
        responseURL: `${baseUrl}/api/payments/first-atlantic/callback`,
      });

      // Update transaction with gateway order ID
      await storage.updatePaymentTransaction(paymentTransaction.id, {
        gatewayOrderId: paymentTransaction.id,
      });

      res.json({
        transactionId: paymentTransaction.id,
        paymentFormData,
      });
    } catch (error: any) {
      console.error("Error initiating First Atlantic payment:", error);
      res.status(500).json({ message: error.message || "Failed to initiate payment" });
    }
  });

  app.post("/api/payments/first-atlantic/callback", async (req: any, res) => {
    try {
      const responseData = req.body;

      // Get payment gateway settings
      const gatewaySettings = await storage.getPaymentGatewaySettings();

      // Verify payment response
      const paymentService = new FirstAtlanticPaymentService(gatewaySettings);
      const verification = paymentService.verifyPaymentResponse(responseData);

      // Get payment transaction
      const transaction = await storage.getPaymentTransaction(responseData.TransactionId);
      if (!transaction) {
        console.error("Payment transaction not found:", responseData.TransactionId);
        return res.status(404).send("<html><body><h1>Payment transaction not found</h1></body></html>");
      }

      // Update transaction status
      if (!verification.isValid) {
        await storage.updatePaymentTransaction(transaction.id, {
          status: "failed",
          errorMessage: verification.error || "Invalid payment response signature",
          gatewayResponse: responseData,
        });
        return res.send(`<html><body><h1>Payment Verification Failed</h1><p>${verification.error}</p></body></html>`);
      }

      if (!verification.isSuccess) {
        await storage.updatePaymentTransaction(transaction.id, {
          status: "failed",
          errorMessage: verification.error || "Payment declined",
          gatewayTransactionId: responseData.ReferenceNumber,
          gatewayResponse: responseData,
          paymentMethodDetails: {
            cardType: responseData.CardType,
            cardLast4: responseData.CardLast4,
          },
        });
        return res.send(`<html><body><h1>Payment Failed</h1><p>${verification.error}</p></body></html>`);
      }

      // Payment successful - update transaction
      await storage.updatePaymentTransaction(transaction.id, {
        status: "completed",
        completedAt: new Date(),
        gatewayTransactionId: responseData.ReferenceNumber,
        gatewayResponse: responseData,
        paymentMethodDetails: {
          cardType: responseData.CardType,
          cardLast4: responseData.CardLast4,
          approvalCode: responseData.ApprovalCode,
        },
      });

      // Create payment record in payments table
      await storage.createPayment({
        invoiceId: transaction.invoiceId,
        amount: transaction.amount,
        paymentMethod: "credit_card",
        transactionId: responseData.ReferenceNumber || transaction.id,
        notes: `First Atlantic payment - Approval Code: ${responseData.ApprovalCode}`,
        createdBy: transaction.customerId,
      });

      // Update invoice status
      const invoice = await storage.getInvoiceById(transaction.invoiceId);
      if (invoice) {
        const newAmountPaid = parseFloat(invoice.amountPaid || "0") + parseFloat(transaction.amount);
        const total = parseFloat(invoice.total);
        const newStatus = newAmountPaid >= total ? "paid" : "partially_paid";

        await storage.updateInvoice(invoice.id, {
          amountPaid: newAmountPaid.toString(),
          status: newStatus,
        });
      }

      // Send success response with redirect
      res.send(`
        <html>
          <body>
            <h1>Payment Successful!</h1>
            <p>Your payment has been processed successfully.</p>
            <p>Transaction ID: ${responseData.ReferenceNumber}</p>
            <p>Approval Code: ${responseData.ApprovalCode}</p>
            <p>You will be redirected to your invoice...</p>
            <script>
              setTimeout(function() {
                window.location.href = "/invoices/${transaction.invoiceId}";
              }, 3000);
            </script>
          </body>
        </html>
      `);
    } catch (error: any) {
      console.error("Error processing First Atlantic callback:", error);
      res.status(500).send(`<html><body><h1>Payment Processing Error</h1><p>${error.message}</p></body></html>`);
    }
  });

  // Get payment transactions for an invoice
  app.get("/api/payments/transactions/:invoiceId", isAuthenticated, async (req: any, res) => {
    try {
      const { invoiceId } = req.params;

      // Get invoice to check access
      const invoice = await storage.getInvoiceById(invoiceId);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      // Check access
      const userId = getUserId(req);
      if (invoice.customerId !== userId && !["admin", "manager", "receptionist"].includes(req.user.role)) {
        return res.status(403).json({ message: "Access denied" });
      }

      const transactions = await storage.getPaymentTransactionsByInvoice(invoiceId);
      res.json(transactions);
    } catch (error) {
      console.error("Error fetching payment transactions:", error);
      res.status(500).json({ message: "Failed to fetch payment transactions" });
    }
  });

  // Customer Payment Endpoints
  app.get("/api/customer/outstanding-invoices", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);

      // Only customers can access this endpoint
      if (req.user.role !== "customer") {
        return res.status(403).json({ message: "Access denied" });
      }

      // Get all unpaid/partially paid invoices for this customer
      const allInvoices = await db
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.customerId, userId),
            or(
              eq(invoices.status, "sent"),
              eq(invoices.status, "partially_paid"),
              eq(invoices.status, "overdue")
            )
          )
        )
        .orderBy(desc(invoices.dueDate));

      // Calculate outstanding amount for each invoice
      const invoicesWithBalance = allInvoices.map(invoice => {
        const total = parseFloat(invoice.total);
        const paid = parseFloat(invoice.amountPaid || "0");
        const outstanding = (total - paid).toFixed(2);

        return {
          ...invoice,
          outstanding
        };
      });

      res.json(invoicesWithBalance);
    } catch (error) {
      console.error("Error fetching outstanding invoices:", error);
      res.status(500).json({ message: "Failed to fetch outstanding invoices" });
    }
  });

  app.post("/api/customer/create-payment-intent", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);

      // Only customers can access this endpoint
      if (req.user.role !== "customer") {
        return res.status(403).json({ message: "Access denied" });
      }

      const { invoiceIds, amounts, provider } = req.body;

      if (!invoiceIds || !Array.isArray(invoiceIds) || invoiceIds.length === 0) {
        return res.status(400).json({ message: "Invalid invoice selection" });
      }

      // Calculate total amount
      let totalAmount = 0;
      for (const invoiceId of invoiceIds) {
        const invoice = await storage.getInvoiceById(invoiceId);
        if (!invoice || invoice.customerId !== userId) {
          return res.status(403).json({ message: "Access denied to invoice" });
        }

        const customAmount = amounts?.[invoiceId];
        const outstanding = parseFloat(invoice.total) - parseFloat(invoice.amountPaid || "0");
        const amount = customAmount ? parseFloat(customAmount) : outstanding;

        if (amount <= 0 || amount > outstanding) {
          return res.status(400).json({ message: "Invalid payment amount" });
        }

        totalAmount += amount;
      }

      // Get payment gateway settings
      const [gatewaySettings] = await db
        .select()
        .from(paymentGatewaySettings)
        .where(eq(paymentGatewaySettings.id, 1))
        .limit(1);

      if (!gatewaySettings) {
        return res.status(500).json({ message: "Payment gateway not configured" });
      }

      // For now, return a mock response - actual implementation would integrate with Stripe/First Atlantic
      // This is a placeholder that should be replaced with actual payment gateway integration
      if (provider === "stripe" && gatewaySettings.stripeEnabled) {
        // TODO: Implement actual Stripe integration
        res.json({
          provider: "stripe",
          publishableKey: gatewaySettings.stripePublishableKey,
          clientSecret: "mock_client_secret", // Replace with actual Stripe payment intent
          amount: totalAmount
        });
      } else if (provider === "first_atlantic" && gatewaySettings.firstAtlanticEnabled) {
        // TODO: Implement actual First Atlantic integration
        res.json({
          provider: "first_atlantic",
          paymentUrl: "mock_payment_url", // Replace with actual First Atlantic payment URL
          amount: totalAmount
        });
      } else {
        return res.status(400).json({ message: "Payment provider not available" });
      }
    } catch (error) {
      console.error("Error creating payment intent:", error);
      res.status(500).json({ message: "Failed to create payment intent" });
    }
  });

  app.get("/api/customer/payment-history", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);

      // Only customers can access this endpoint
      if (req.user.role !== "customer") {
        return res.status(403).json({ message: "Access denied" });
      }

      // Get payment transactions for this customer
      const transactions = await db
        .select()
        .from(onlinePaymentTransactions)
        .where(eq(onlinePaymentTransactions.customerId, userId))
        .orderBy(desc(onlinePaymentTransactions.createdAt))
        .limit(50);

      res.json(transactions);
    } catch (error) {
      console.error("Error fetching payment history:", error);
      res.status(500).json({ message: "Failed to fetch payment history" });
    }
  });

  app.get("/api/payment-gateway-settings", isAuthenticated, async (req: any, res) => {
    try {
      const [settings] = await db
        .select()
        .from(paymentGatewaySettings)
        .where(eq(paymentGatewaySettings.id, 1))
        .limit(1);

      if (!settings) {
        return res.json({
          stripeEnabled: false,
          firstAtlanticEnabled: false,
          paypalEnabled: false
        });
      }

      // Return only public, non-sensitive settings
      res.json({
        stripeEnabled: settings.stripeEnabled,
        stripeTestMode: settings.stripeTestMode,
        firstAtlanticEnabled: settings.firstAtlanticEnabled,
        firstAtlanticTestMode: settings.firstAtlanticTestMode,
        paypalEnabled: settings.paypalEnabled,
        paypalTestMode: settings.paypalTestMode
      });
    } catch (error) {
      console.error("Error fetching payment gateway settings:", error);
      res.status(500).json({ message: "Failed to fetch payment gateway settings" });
    }
  });

  // Vendor Management
  app.get("/api/vendors", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const { isActive } = req.query;
      const filters = isActive !== undefined ? { isActive: isActive === "true" } : undefined;
      const vendors = await storage.getAllVendors(filters);
      res.json(vendors);
    } catch (error) {
      console.error("Error fetching vendors:", error);
      res.status(500).json({ message: "Failed to fetch vendors" });
    }
  });

  app.post("/api/vendors", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const vendor = await storage.createVendor({
        ...req.body,
        createdBy: getUserId(req),
      });
      res.json(vendor);
    } catch (error) {
      console.error("Error creating vendor:", error);
      res.status(400).json({ message: "Failed to create vendor" });
    }
  });

  app.get("/api/vendors/:id", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const vendor = await storage.getVendorById(req.params.id);
      if (!vendor) {
        return res.status(404).json({ message: "Vendor not found" });
      }
      res.json(vendor);
    } catch (error) {
      console.error("Error fetching vendor:", error);
      res.status(500).json({ message: "Failed to fetch vendor" });
    }
  });

  app.patch("/api/vendors/:id", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const vendor = await storage.updateVendor(req.params.id, req.body);
      res.json(vendor);
    } catch (error) {
      console.error("Error updating vendor:", error);
      res.status(400).json({ message: "Failed to update vendor" });
    }
  });

  app.delete("/api/vendors/:id", isAuthenticated, requireRole(["admin"]), async (req: any, res) => {
    try {
      await storage.deleteVendor(req.params.id);
      res.json({ message: "Vendor deleted successfully" });
    } catch (error) {
      console.error("Error deleting vendor:", error);
      res.status(500).json({ message: "Failed to delete vendor" });
    }
  });

  // Vendor Bills
  app.get("/api/vendor-bills", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const { vendorId, status } = req.query;
      const filters: any = {};
      if (vendorId) filters.vendorId = vendorId;
      if (status) filters.status = status;
      const bills = await storage.getAllVendorBills(filters);
      res.json(bills);
    } catch (error) {
      console.error("Error fetching vendor bills:", error);
      res.status(500).json({ message: "Failed to fetch vendor bills" });
    }
  });

  app.post("/api/vendor-bills", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const { lineItems, ...billData } = req.body;
      const bill = await storage.createVendorBill(
        {
          ...billData,
          billDate: new Date(billData.billDate),
          dueDate: billData.dueDate ? new Date(billData.dueDate) : undefined,
          recordedBy: getUserId(req),
        },
        lineItems || []
      );
      res.json(bill);
    } catch (error) {
      console.error("Error creating vendor bill:", error);
      res.status(400).json({ message: "Failed to create vendor bill" });
    }
  });

  app.get("/api/vendor-bills/:id", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const bill = await storage.getVendorBillById(req.params.id);
      if (!bill) {
        return res.status(404).json({ message: "Vendor bill not found" });
      }
      const lineItems = await storage.getVendorBillLineItems(req.params.id);
      res.json({ ...bill, lineItems });
    } catch (error) {
      console.error("Error fetching vendor bill:", error);
      res.status(500).json({ message: "Failed to fetch vendor bill" });
    }
  });

  app.patch("/api/vendor-bills/:id", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const bill = await storage.updateVendorBill(req.params.id, req.body);
      res.json(bill);
    } catch (error) {
      console.error("Error updating vendor bill:", error);
      res.status(400).json({ message: "Failed to update vendor bill" });
    }
  });

  app.delete("/api/vendor-bills/:id", isAuthenticated, requireRole(["admin"]), async (req: any, res) => {
    try {
      await storage.deleteVendorBill(req.params.id);
      res.json({ message: "Vendor bill deleted successfully" });
    } catch (error) {
      console.error("Error deleting vendor bill:", error);
      res.status(500).json({ message: "Failed to delete vendor bill" });
    }
  });

  // Vendor Payments
  app.get("/api/vendor-payments", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const { vendorId, billId } = req.query;
      const filters: any = {};
      if (vendorId) filters.vendorId = vendorId;
      if (billId) filters.billId = billId;
      const payments = await storage.getAllVendorPayments(filters);
      res.json(payments);
    } catch (error) {
      console.error("Error fetching vendor payments:", error);
      res.status(500).json({ message: "Failed to fetch vendor payments" });
    }
  });

  app.post("/api/vendor-payments", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const payment = await storage.createVendorPayment({
        ...req.body,
        paymentDate: new Date(req.body.paymentDate || Date.now()),
        recordedBy: getUserId(req),
      });
      res.json(payment);
    } catch (error) {
      console.error("Error creating vendor payment:", error);
      res.status(400).json({ message: "Failed to create vendor payment" });
    }
  });

  // Accounting Reports
  app.get("/api/reports/ar-aging", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const report = await storage.getARAgingReport();
      res.json(report);
    } catch (error) {
      console.error("Error generating AR aging report:", error);
      res.status(500).json({ message: "Failed to generate AR aging report" });
    }
  });

  app.get("/api/reports/ap-aging", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const report = await storage.getVendorAgingReport();
      res.json(report);
    } catch (error) {
      console.error("Error generating AP aging report:", error);
      res.status(500).json({ message: "Failed to generate AP aging report" });
    }
  });

  app.get("/api/reports/outstanding-invoices", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const report = await storage.getOutstandingInvoices();
      res.json(report);
    } catch (error) {
      console.error("Error fetching outstanding invoices:", error);
      res.status(500).json({ message: "Failed to fetch outstanding invoices" });
    }
  });

  app.get("/api/reports/cash-flow", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const { startDate, endDate } = req.query;
      const start = startDate ? new Date(startDate as string) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const end = endDate ? new Date(endDate as string) : new Date();
      const report = await storage.getCashFlowData(start, end);
      res.json(report);
    } catch (error) {
      console.error("Error generating cash flow report:", error);
      res.status(500).json({ message: "Failed to generate cash flow report" });
    }
  });

  app.get("/api/reports/customer-payment-history/:customerId", isAuthenticated, async (req: any, res) => {
    try {
      const { customerId } = req.params;
      const userId = getUserId(req);

      // Check if user has access
      if (customerId !== userId && !["admin", "manager", "receptionist"].includes(req.user.role)) {
        return res.status(403).json({ message: "Access denied" });
      }

      const history = await storage.getCustomerPaymentHistory(customerId);
      res.json(history);
    } catch (error) {
      console.error("Error fetching customer payment history:", error);
      res.status(500).json({ message: "Failed to fetch payment history" });
    }
  });

  // Customer Statement
  app.get("/api/customer-statement/:customerId", isAuthenticated, async (req: any, res) => {
    try {
      const { customerId } = req.params;
      const { startDate, endDate } = req.query;
      const userId = getUserId(req);

      // Check if user has access
      if (customerId !== userId && !["admin", "manager", "receptionist"].includes(req.user.role)) {
        return res.status(403).json({ message: "Access denied" });
      }

      const start = startDate ? new Date(startDate as string) : undefined;
      const end = endDate ? new Date(endDate as string) : undefined;

      const statement = await storage.getCustomerStatement(customerId, start, end);
      res.json(statement);
    } catch (error) {
      console.error("Error generating customer statement:", error);
      res.status(500).json({ message: "Failed to generate customer statement" });
    }
  });

  // Service Catalog
  app.get("/api/services", async (req: any, res) => {
    try {
      const services = await db.select()
        .from(serviceCatalog)
        .where(eq(serviceCatalog.isActive, true))
        .orderBy(asc(serviceCatalog.displayOrder));
      res.json(services);
    } catch (error) {
      console.error("Error fetching services:", error);
      res.status(500).json({ message: "Failed to fetch services" });
    }
  });

  app.get("/api/services/all", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const services = await db.select()
        .from(serviceCatalog)
        .orderBy(asc(serviceCatalog.displayOrder));
      res.json(services);
    } catch (error) {
      console.error("Error fetching all services:", error);
      res.status(500).json({ message: "Failed to fetch services" });
    }
  });

  app.post("/api/services", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const validated = insertServiceCatalogSchema.parse(req.body);
      const [service] = await db.insert(serviceCatalog)
        .values(validated)
        .returning();
      res.json(service);
    } catch (error) {
      console.error("Error creating service:", error);
      res.status(400).json({ message: "Failed to create service" });
    }
  });

  app.patch("/api/services/:id", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const validated = updateServiceCatalogSchema.parse(req.body);
      const [service] = await db.update(serviceCatalog)
        .set({ ...validated, updatedAt: new Date() })
        .where(eq(serviceCatalog.id, req.params.id))
        .returning();

      if (!service) {
        return res.status(404).json({ message: "Service not found" });
      }

      res.json(service);
    } catch (error) {
      console.error("Error updating service:", error);
      res.status(400).json({ message: "Failed to update service" });
    }
  });

  app.delete("/api/services/:id", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      // Soft delete by setting isActive to false
      const [service] = await db.update(serviceCatalog)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(serviceCatalog.id, req.params.id))
        .returning();

      if (!service) {
        return res.status(404).json({ message: "Service not found" });
      }

      res.json({ message: "Service deleted successfully" });
    } catch (error) {
      console.error("Error deleting service:", error);
      res.status(500).json({ message: "Failed to delete service" });
    }
  });

  app.patch("/api/services/reorder", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      // Expect array of { id, displayOrder } objects
      const { services } = req.body;

      if (!Array.isArray(services)) {
        return res.status(400).json({ message: "Invalid request: services must be an array" });
      }

      // Update display order for each service
      for (const { id, displayOrder } of services) {
        await db.update(serviceCatalog)
          .set({ displayOrder, updatedAt: new Date() })
          .where(eq(serviceCatalog.id, id));
      }

      res.json({ message: "Service order updated successfully" });
    } catch (error) {
      console.error("Error reordering services:", error);
      res.status(500).json({ message: "Failed to reorder services" });
    }
  });

  // Job Cards
  app.get("/api/job-cards", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const currentUser = await storage.getUser(userId);
      const { customerId, vehicleId } = req.query;
      
      if (currentUser?.role === "customer") {
        const jobCards = await storage.getJobCardsByCustomer(userId);
        res.json(jobCards);
      } else if (currentUser?.role === "mechanic") {
        const jobCards = await storage.getJobCardsByMechanic(userId);
        res.json(jobCards);
      } else if (vehicleId) {
        // Staff can filter by vehicle ID
        const jobCards = await storage.getJobCardsByVehicle(vehicleId as string);
        res.json(jobCards);
      } else if (customerId) {
        // Staff can filter by customer ID
        const jobCards = await storage.getJobCardsByCustomer(customerId as string);
        res.json(jobCards);
      } else {
        const jobCards = await storage.getAllJobCards();
        res.json(jobCards);
      }
    } catch (error) {
      console.error("Error fetching job cards:", error);
      res.status(500).json({ message: "Failed to fetch job cards" });
    }
  });

  app.post("/api/job-cards", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req: any, res) => {
    try {
      // Convert ISO string to Date object and numbers to strings for validation
      const jobCardData = {
        ...req.body,
        scheduledDate: req.body.scheduledDate ? new Date(req.body.scheduledDate) : undefined,
        laborHours: req.body.laborHours !== undefined ? String(req.body.laborHours) : undefined,
        laborRate: req.body.laborRate !== undefined ? String(req.body.laborRate) : undefined,
        totalCost: req.body.totalCost !== undefined ? String(req.body.totalCost) : undefined,
      };

      const validated = insertJobCardSchema.parse(jobCardData);
      const jobCard = await storage.createJobCard(validated);
      res.json(jobCard);
    } catch (error) {
      console.error("Error creating job card:", error);
      res.status(400).json({ message: "Failed to create job card" });
    }
  });

  app.patch("/api/job-cards/:id", isAuthenticated, requireRole(["admin", "manager", "mechanic"]), async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const currentUser = await storage.getUser(userId);
      
      // Get current job card state before update
      const jobCard = await storage.getJobCard(req.params.id);
      if (!jobCard) {
        return res.status(404).json({ message: "Job card not found" });
      }
      
      // Mechanics can only update status and labor hours on their own job cards
      if (currentUser?.role === "mechanic") {
        if (jobCard?.mechanicId !== userId) {
          return res.status(403).json({ message: "Forbidden: Can only update your own job cards" });
        }
        
        // Whitelist and validate only allowed fields for mechanics
        const updateData: any = {};
        if (req.body.status) updateData.status = req.body.status;
        if (req.body.laborHours !== undefined) {
          updateData.laborHours = String(req.body.laborHours);
        }
        
        // Auto-start timer when mechanic moves to "in_progress" status (accepting the job card)
        if (req.body.status === "in_progress" && jobCard.status !== "in_progress") {
          const existingTimer = await storage.getActiveTimerSession(req.params.id);
          if (!existingTimer) {
            // No active timer exists, create one
            const timerData = {
              jobCardId: req.params.id,
              mechanicId: userId,
              startTime: new Date(),
              isActive: true,
            };
            await storage.createTimerSession(timerData);
          }
        }
        
        // Auto-stop timer when status changes to completed
        if (req.body.status === "completed" && jobCard.status !== "completed") {
          const activeTimer = await storage.getActiveTimerSession(req.params.id);
          if (activeTimer && activeTimer.mechanicId === userId) {
            // Calculate total elapsed time
            const start = new Date(activeTimer.startTime).getTime();
            const now = Date.now();
            const elapsed = Math.floor((now - start) / 1000) + (activeTimer.totalSeconds || 0);
            
            // Stop the timer
            await storage.updateTimerSession(activeTimer.id, {
              endTime: new Date(),
              totalSeconds: elapsed,
              isActive: false,
            });
          }
        }
        
        const updated = await storage.updateJobCard(req.params.id, updateData);
        if (!updated) {
          return res.status(404).json({ message: "Job card not found" });
        }
        
        // Send push notification if job completed
        if (req.body.status === "completed" && jobCard.status !== "completed") {
          const customer = await storage.getUser(updated.customerId);
          const vehicle = await storage.getVehicle(updated.vehicleId);
          if (customer) {
            const notification = pushNotificationService.createJobCardNotification(
              'completed',
              {
                description: updated.description,
                vehicleMake: vehicle?.make,
                vehicleModel: vehicle?.model,
              }
            );
            pushNotificationService.sendToUser(customer, notification).catch(err => {
              console.error('Failed to send job card completion notification:', err);
            });
          }
        }
        
        res.json(updated);
      } else {
        // Admin/Manager can update all fields except customerId
        // Convert numeric fields to strings for validation
        const jobCardData = {
          ...req.body,
          scheduledDate: req.body.scheduledDate ? new Date(req.body.scheduledDate) : undefined,
          laborHours: req.body.laborHours !== undefined ? String(req.body.laborHours) : undefined,
          laborRate: req.body.laborRate !== undefined ? String(req.body.laborRate) : undefined,
          totalCost: req.body.totalCost !== undefined ? String(req.body.totalCost) : undefined,
        };
        
        const validated = updateJobCardSchema.parse(jobCardData);
        const updateData: any = { ...validated };
        if (validated.status === "completed") {
          updateData.completedAt = new Date();
          
          // Auto-stop timer when status changes to completed
          if (jobCard.status !== "completed") {
            const activeTimer = await storage.getActiveTimerSession(req.params.id);
            if (activeTimer) {
              // Calculate total elapsed time
              const start = new Date(activeTimer.startTime).getTime();
              const now = Date.now();
              const elapsed = Math.floor((now - start) / 1000) + (activeTimer.totalSeconds || 0);
              
              // Stop the timer
              await storage.updateTimerSession(activeTimer.id, {
                endTime: new Date(),
                totalSeconds: elapsed,
                isActive: false,
              });
            }
          }
        }
        
        // Auto-start timer when mechanic is assigned
        if (validated.mechanicId && !jobCard.mechanicId && validated.status !== "completed" && validated.status !== "cancelled") {
          // Check if timer already exists to prevent duplicates
          const existingTimer = await storage.getActiveTimerSession(req.params.id);
          if (!existingTimer) {
            // Create a new timer session for the assigned mechanic
            const timerData = {
              jobCardId: req.params.id,
              mechanicId: validated.mechanicId,
              startTime: new Date(),
              isActive: true,
            };
            await storage.createTimerSession(timerData);
          }
        }
        
        const updated = await storage.updateJobCard(req.params.id, updateData);
        if (!updated) {
          return res.status(404).json({ message: "Job card not found" });
        }

        // Send push notifications on status changes
        if (validated.status && validated.status !== jobCard.status) {
          const customer = await storage.getUser(updated.customerId);
          const vehicle = await storage.getVehicle(updated.vehicleId);

          if (customer) {
            let notificationType: 'started' | 'in_progress' | 'completed' | 'on_hold' | null = null;

            // Map status to notification type
            if (validated.status === "in_progress" && jobCard.status !== "in_progress") {
              notificationType = 'in_progress';
            } else if (validated.status === "completed" && jobCard.status !== "completed") {
              notificationType = 'completed';
            } else if (validated.status === "awaiting_parts" && jobCard.status !== "awaiting_parts") {
              notificationType = 'on_hold'; // Map awaiting_parts to on_hold notification
            }

            if (notificationType) {
              const notification = pushNotificationService.createJobCardNotification(
                notificationType,
                {
                  description: updated.description,
                  vehicleMake: vehicle?.make,
                  vehicleModel: vehicle?.model,
                }
              );
              pushNotificationService.sendToUser(customer, notification).catch(err => {
                console.error(`Failed to send job card ${notificationType} notification:`, err);
              });
            }
          }
        }

        res.json(updated);
      }
    } catch (error) {
      console.error("Error updating job card:", error);
      res.status(500).json({ message: "Failed to update job card" });
    }
  });

  app.post("/api/job-cards/:id/generate-invoice", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const jobCard = await storage.getJobCard(req.params.id);

      if (!jobCard) {
        return res.status(404).json({ message: "Job card not found" });
      }

      // Check if job card is in a valid state for invoicing
      if (jobCard.status !== "completed") {
        return res.status(400).json({ message: "Can only generate invoices for completed job cards" });
      }

      // Check if invoice already exists for this job card
      const existingInvoice = await db.select()
        .from(invoices)
        .where(eq(invoices.jobCardId, req.params.id))
        .limit(1);

      if (existingInvoice.length > 0) {
        return res.status(400).json({
          message: "Invoice already exists for this job card",
          invoiceId: existingInvoice[0].id
        });
      }

      const invoice = await storage.generateInvoiceFromJobCard(req.params.id);

      // Send push notification to customer
      const customer = await storage.getUser(invoice.customerId);
      if (customer) {
        const notification = pushNotificationService.createInvoiceNotification({
          invoiceNumber: invoice.invoiceNumber,
          total: parseFloat(invoice.total || '0'),
        });
        pushNotificationService.sendToUser(customer, notification).catch(err => {
          console.error('Failed to send invoice notification:', err);
        });
      }

      res.json(invoice);
    } catch (error) {
      console.error("Error generating invoice from job card:", error);
      res.status(500).json({ message: "Failed to generate invoice" });
    }
  });

  // Job Card Parts Management
  app.get("/api/job-cards/:jobCardId/parts", isAuthenticated, async (req: any, res) => {
    try {
      const parts = await storage.getJobCardParts(req.params.jobCardId);
      res.json(parts);
    } catch (error) {
      console.error("Error fetching job card parts:", error);
      res.status(500).json({ message: "Failed to fetch job card parts" });
    }
  });

  app.post("/api/job-cards/:jobCardId/parts", isAuthenticated, requireRole(["admin", "manager", "mechanic"]), async (req: any, res) => {
    try {
      const validated = insertJobCardPartSchema.parse(req.body);
      const jobCardPart = await storage.addPartToJobCard({
        ...validated,
        jobCardId: req.params.jobCardId,
      });
      res.json(jobCardPart);
    } catch (error: any) {
      console.error("Error adding part to job card:", error);
      // Return specific error message for insufficient stock
      if (error.message?.includes("Insufficient stock")) {
        return res.status(400).json({ message: error.message });
      }
      res.status(500).json({ message: "Failed to add part to job card" });
    }
  });

  app.patch("/api/job-cards/parts/:partId", isAuthenticated, requireRole(["admin", "manager", "mechanic"]), async (req: any, res) => {
    try {
      const { quantity } = req.body;
      if (!quantity || quantity <= 0) {
        return res.status(400).json({ message: "Invalid quantity" });
      }

      const updatedPart = await storage.updateJobCardPartQuantity(req.params.partId, quantity);
      res.json(updatedPart);
    } catch (error: any) {
      console.error("Error updating job card part quantity:", error);
      // Return specific error message for insufficient stock
      if (error.message?.includes("Insufficient stock")) {
        return res.status(400).json({ message: error.message });
      }
      res.status(500).json({ message: "Failed to update part quantity" });
    }
  });

  app.delete("/api/job-cards/parts/:partId", isAuthenticated, requireRole(["admin", "manager", "mechanic"]), async (req: any, res) => {
    try {
      await storage.removePartFromJobCard(req.params.partId);
      res.json({ message: "Part removed from job card and stock restored" });
    } catch (error) {
      console.error("Error removing part from job card:", error);
      res.status(500).json({ message: "Failed to remove part from job card" });
    }
  });

  // Parts Inventory (staff only)
  app.get("/api/parts", isAuthenticated, requireRole(["admin", "manager", "mechanic", "receptionist"]), async (req: any, res) => {
    try {
      const parts = await storage.getAllParts();
      res.json(parts);
    } catch (error) {
      console.error("Error fetching parts:", error);
      res.status(500).json({ message: "Failed to fetch parts" });
    }
  });

  app.get("/api/parts/low-stock", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const parts = await storage.getLowStockParts();
      res.json(parts);
    } catch (error) {
      console.error("Error fetching low stock parts:", error);
      res.status(500).json({ message: "Failed to fetch low stock parts" });
    }
  });

  app.post("/api/parts", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const validated = insertPartSchema.parse(req.body);
      const part = await storage.createPart(validated);
      res.json(part);
    } catch (error) {
      console.error("Error creating part:", error);
      res.status(400).json({ message: "Failed to create part" });
    }
  });

  app.patch("/api/parts/:id", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const validated = updatePartSchema.parse(req.body);
      const part = await storage.updatePart(req.params.id, validated);
      
      // Check for low stock and send notification to admin/managers
      if (part && part.quantity <= part.lowStockThreshold) {
        const staff = await storage.getAllStaff();
        const adminManagers = staff.filter(s =>
          (s.role === 'admin' || s.role === 'manager') && s.isActive
        );
        if (adminManagers.length > 0) {
          const notification = pushNotificationService.createLowStockNotification({
            partName: part.name,
            quantityInStock: part.quantity,
          });
          pushNotificationService.sendToMultipleUsers(adminManagers, notification).catch(err => {
            console.error('Failed to send low stock notification:', err);
          });
        }
      }
      
      res.json(part);
    } catch (error) {
      console.error("Error updating part:", error);
      res.status(400).json({ message: "Failed to update part" });
    }
  });

  app.get("/api/parts/barcode/:barcode", isAuthenticated, requireRole(["admin", "manager", "mechanic", "receptionist"]), async (req: any, res) => {
    try {
      const part = await storage.getPartByBarcode(req.params.barcode);
      if (!part) {
        return res.status(404).json({ message: "Part not found" });
      }
      res.json(part);
    } catch (error) {
      console.error("Error fetching part by barcode:", error);
      res.status(500).json({ message: "Failed to fetch part" });
    }
  });

  // Vehicles
  // Get all vehicles (staff only)
  app.get("/api/vehicles", isAuthenticated, requireRole(["admin", "manager", "mechanic", "receptionist"]), async (req: any, res) => {
    try {
      const vehicles = await storage.getAllVehicles();
      res.json(vehicles);
    } catch (error) {
      console.error("Error fetching vehicles:", error);
      res.status(500).json({ message: "Failed to fetch vehicles" });
    }
  });

  app.get("/api/vehicles/customer/:customerId", isAuthenticated, requireOwnershipOrRole(["admin", "manager", "mechanic", "receptionist"]), async (req: any, res) => {
    try {
      const vehicles = await storage.getVehiclesByCustomer(req.params.customerId);
      res.json(vehicles);
    } catch (error) {
      console.error("Error fetching vehicles:", error);
      res.status(500).json({ message: "Failed to fetch vehicles" });
    }
  });

  app.post("/api/vehicles", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const currentUser = await storage.getUser(userId);

      // For customers, customerId is always their own userId (derived from session)
      // For staff, customerId must be provided in request body
      let customerId: string;
      if (currentUser?.role === "customer") {
        customerId = userId; // Derive from session, ignore client value
      } else {
        // Staff can create vehicles for any customer
        customerId = req.body.customerId;
        if (!customerId) {
          return res.status(400).json({ message: "customerId is required for staff" });
        }
      }

      // Validate or use default branch code
      // For customers, use default "CU" (Customer) branch if not provided
      // For staff, require branch code
      let branchCode = req.body.branchCode;
      
      if (currentUser?.role === "customer") {
        // Customer: use default if not provided
        branchCode = branchCode || "CU";
      } else {
        // Staff: require branch code
        if (!branchCode || !/^[A-Z]{2}$/.test(branchCode)) {
          return res.status(400).json({
            message: "branchCode is required and must be exactly 2 uppercase letters (e.g., KN, SA, MO)"
          });
        }
      }

      // Generate unique vehicle code and QR token
      const vehicleCode = await generateVehicleCode(branchCode);
      const qrToken = generateQRToken();

      const vehicleData = {
        ...req.body,
        customerId, // Use server-derived value
        vehicleCode, // Auto-generated
        branchCode, // Validated
        qrToken, // Auto-generated
        qrGeneratedAt: new Date(), // Timestamp
      };

      // Convert registrationExpiry string to Date if present
      if (vehicleData.registrationExpiry && typeof vehicleData.registrationExpiry === 'string') {
        vehicleData.registrationExpiry = new Date(vehicleData.registrationExpiry);
      }

      const validated = insertVehicleSchema.parse(vehicleData);
      const vehicle = await storage.createVehicle(validated);
      res.json(vehicle);
    } catch (error) {
      console.error("Error creating vehicle:", error);
      res.status(400).json({ message: "Failed to create vehicle" });
    }
  });

  // Bulk vehicle upload for business customers
  app.post("/api/vehicles/bulk-upload", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const currentUser = await storage.getUser(userId);

      // Only business customers and staff can use bulk upload
      if (currentUser?.role === "customer" && currentUser?.customerType !== "business") {
        return res.status(403).json({
          message: "Bulk upload is only available for business customers"
        });
      }

      // For customers, customerId is always their own userId (derived from session)
      // For staff, customerId must be provided in request body
      let customerId: string;
      if (currentUser?.role === "customer") {
        customerId = userId; // Derive from session, ignore client value
      } else {
        // Staff can create vehicles for any customer
        customerId = req.body.customerId;
        if (!customerId) {
          return res.status(400).json({ message: "customerId is required for staff" });
        }
      }

      const vehicles = req.body.vehicles;
      if (!Array.isArray(vehicles) || vehicles.length === 0) {
        return res.status(400).json({
          message: "Invalid request: vehicles array is required and must not be empty"
        });
      }

      // Limit to reasonable batch size
      if (vehicles.length > 500) {
        return res.status(400).json({
          message: "Too many vehicles: maximum 500 vehicles per upload"
        });
      }

      const results = {
        successful: [] as any[],
        failed: [] as { row: number; data: any; error: string }[],
      };

      // Process each vehicle
      for (let i = 0; i < vehicles.length; i++) {
        try {
          const vehicleData = {
            ...vehicles[i],
            customerId, // Use server-derived value
          };

          const validated = insertVehicleSchema.parse(vehicleData);
          const vehicle = await storage.createVehicle(validated);
          results.successful.push(vehicle);
        } catch (error: any) {
          results.failed.push({
            row: i + 1,
            data: vehicles[i],
            error: error.message || "Unknown error",
          });
        }
      }

      res.json({
        message: `Processed ${vehicles.length} vehicles: ${results.successful.length} successful, ${results.failed.length} failed`,
        total: vehicles.length,
        successCount: results.successful.length,
        failedCount: results.failed.length,
        successful: results.successful,
        failed: results.failed,
      });
    } catch (error) {
      console.error("Error in bulk vehicle upload:", error);
      res.status(500).json({ message: "Failed to process bulk upload" });
    }
  });

  app.patch("/api/vehicles/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const currentUser = await storage.getUser(userId);
      const vehicle = await storage.getVehicle(req.params.id);

      if (!vehicle) {
        return res.status(404).json({ message: "Vehicle not found" });
      }

      // Authorization: customers can only edit their own vehicles, staff can edit any
      if (currentUser?.role === "customer" && vehicle.customerId !== userId) {
        return res.status(403).json({ message: "Forbidden: Cannot edit another customer's vehicle" });
      }

      // Use appropriate schema: customers cannot change customerId, staff can
      const isStaff = currentUser?.role && ["admin", "manager", "mechanic", "receptionist"].includes(currentUser.role);
      const schema = isStaff ? staffUpdateVehicleSchema : updateVehicleSchema;
      
      console.log("Vehicle update - Role:", currentUser?.role, "isStaff:", isStaff, "Schema:", isStaff ? "staff" : "customer");
      console.log("Request body:", JSON.stringify(req.body, null, 2));
      
      const validated = schema.parse(req.body);

      const updated = await storage.updateVehicle(req.params.id, validated);
      res.json(updated);
    } catch (error) {
      console.error("Error updating vehicle:", error);
      if (error instanceof Error) {
        console.error("Error details:", error.message);
      }
      res.status(400).json({ message: "Failed to update vehicle" });
    }
  });

  app.delete("/api/vehicles/:id", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req: any, res) => {
    try {
      const vehicle = await storage.getVehicle(req.params.id);
      if (!vehicle) {
        return res.status(404).json({ message: "Vehicle not found" });
      }

      await storage.deleteVehicle(req.params.id);
      res.json({ message: "Vehicle deleted successfully" });
    } catch (error) {
      console.error("Error deleting vehicle:", error);
      res.status(500).json({ message: "Failed to delete vehicle" });
    }
  });

  // Get QR code image for vehicle (staff only)
  app.get("/api/vehicles/:id/qr", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req: any, res) => {
    try {
      const vehicle = await storage.getVehicle(req.params.id);
      if (!vehicle) {
        return res.status(404).json({ message: "Vehicle not found" });
      }

      if (!vehicle.vehicleCode || !vehicle.qrToken) {
        return res.status(400).json({ message: "Vehicle does not have QR code generated" });
      }

      // Generate QR code URL
      const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
      const qrUrl = `${baseUrl}/vehicle/${vehicle.vehicleCode}/${vehicle.qrToken}`;

      // Generate QR code as PNG buffer
      const qrImageBuffer = await QRCode.toBuffer(qrUrl, {
        type: "png",
        width: 300,
        margin: 2,
      });

      res.setHeader("Content-Type", "image/png");
      res.send(qrImageBuffer);
    } catch (error) {
      console.error("Error generating QR code:", error);
      res.status(500).json({ message: "Failed to generate QR code" });
    }
  });

  // Regenerate QR token for vehicle (staff only)
  app.post("/api/vehicles/:id/qr/regenerate", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const vehicle = await storage.getVehicle(req.params.id);
      if (!vehicle) {
        return res.status(404).json({ message: "Vehicle not found" });
      }

      // Generate new token
      const newToken = generateQRToken();
      const updated = await storage.updateVehicle(req.params.id, {
        qrToken: newToken,
        qrGeneratedAt: new Date(),
      });

      res.json({
        message: "QR token regenerated successfully",
        vehicle: updated,
      });
    } catch (error) {
      console.error("Error regenerating QR token:", error);
      res.status(500).json({ message: "Failed to regenerate QR token" });
    }
  });

  // Public endpoint: Get vehicle info by QR code (no authentication, rate-limited)
  app.get("/api/public/vehicle/:vehicleCode/:token", async (req: any, res) => {
    try {
      const { vehicleCode, token } = req.params;

      // Validate format
      if (!/^316-[A-Z]{2}-\d{4}$/.test(vehicleCode)) {
        return res.status(400).json({ message: "Invalid vehicle code format" });
      }

      // Get vehicle by code and token (secure lookup)
      const vehicle = await storage.getVehicleByCodeAndToken(vehicleCode, token);
      if (!vehicle) {
        return res.status(403).json({ message: "Invalid vehicle code or token" });
      }

      // Get maintenance status
      const maintenanceStatus = await storage.getVehicleMaintenanceStatus(vehicle.id);

      // Get document expiries
      const documentExpiries = await storage.getVehicleDocumentExpiries(vehicle.id);

      // Get next service from maintenance schedules
      const maintenanceSchedules = await storage.getVehicleMaintenanceSchedules(vehicle.id);
      const upcomingServices = maintenanceSchedules
        .filter((s) => s.nextServiceDueDate || s.nextMileageDue)
        .map((s) => ({
          serviceType: s.serviceType,
          nextServiceDate: s.nextServiceDueDate,
          nextMileageDue: s.nextMileageDue,
        }));

      // Return public vehicle info (no sensitive data)
      res.json({
        vehicle: {
          code: vehicle.vehicleCode,
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          licensePlate: vehicle.licensePlate,
        },
        maintenance: {
          currentMileage: maintenanceStatus.currentMileage,
          oilChange: {
            lastDate: maintenanceStatus.lastOilChangeDate,
            lastMileage: maintenanceStatus.lastOilChangeMileage,
            nextMileage: maintenanceStatus.nextOilChangeMileage,
            progress: maintenanceStatus.oilChangeProgress,
          },
          upcomingServices,
        },
        documents: documentExpiries,
      });
    } catch (error) {
      console.error("Error fetching public vehicle info:", error);
      res.status(500).json({ message: "Failed to fetch vehicle information" });
    }
  });

  app.get("/api/vehicles/:vehicleId/service-history", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const currentUser = await storage.getUser(userId);
      const vehicle = await storage.getVehicle(req.params.vehicleId);

      if (!vehicle) {
        return res.status(404).json({ message: "Vehicle not found" });
      }

      // Authorization: customers can only view their own vehicle history, staff can view any
      if (currentUser?.role === "customer" && vehicle.customerId !== userId) {
        return res.status(403).json({ message: "Forbidden: Cannot view another customer's vehicle history" });
      }

      const jobCards = await storage.getJobCardsByVehicle(req.params.vehicleId);

      // Get customer info
      const customer = await storage.getUser(vehicle.customerId);

      res.json({
        vehicle,
        customer,
        jobCards,
      });
    } catch (error) {
      console.error("Error fetching service history:", error);
      res.status(500).json({ message: "Failed to fetch service history" });
    }
  });

  // Vehicle Documents
  app.get("/api/vehicles/:vehicleId/documents", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const currentUser = await storage.getUser(userId);
      const vehicle = await storage.getVehicle(req.params.vehicleId);

      if (!vehicle) {
        return res.status(404).json({ message: "Vehicle not found" });
      }

      // Authorization: customers can only view their own vehicle documents, staff can view any
      if (currentUser?.role === "customer" && vehicle.customerId !== userId) {
        return res.status(403).json({ message: "Forbidden: Cannot view another customer's vehicle documents" });
      }

      const documents = await db.select()
        .from(vehicleDocuments)
        .where(eq(vehicleDocuments.vehicleId, req.params.vehicleId))
        .orderBy(desc(vehicleDocuments.uploadedAt));

      res.json(documents);
    } catch (error) {
      console.error("Error fetching vehicle documents:", error);
      res.status(500).json({ message: "Failed to fetch vehicle documents" });
    }
  });

  app.post("/api/vehicles/:vehicleId/documents", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const currentUser = await storage.getUser(userId);
      const vehicle = await storage.getVehicle(req.params.vehicleId);

      if (!vehicle) {
        return res.status(404).json({ message: "Vehicle not found" });
      }

      // Authorization: customers can only upload to their own vehicles, staff can upload to any
      if (currentUser?.role === "customer" && vehicle.customerId !== userId) {
        return res.status(403).json({ message: "Forbidden: Cannot upload documents to another customer's vehicle" });
      }

      // Parse and validate the request body
      const data = {
        ...req.body,
        vehicleId: req.params.vehicleId,
        uploadedBy: userId,
        expiryDate: req.body.expiryDate ? new Date(req.body.expiryDate) : null,
      };

      const validated = insertVehicleDocumentSchema.parse(data);

      const [document] = await db.insert(vehicleDocuments)
        .values(validated)
        .returning();

      res.json(document);
    } catch (error) {
      console.error("Error uploading vehicle document:", error);
      res.status(400).json({ message: "Failed to upload vehicle document" });
    }
  });

  app.patch("/api/vehicles/:vehicleId/documents/:documentId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const currentUser = await storage.getUser(userId);
      const vehicle = await storage.getVehicle(req.params.vehicleId);

      if (!vehicle) {
        return res.status(404).json({ message: "Vehicle not found" });
      }

      // Authorization: customers can only update their own vehicle documents, staff can update any
      if (currentUser?.role === "customer" && vehicle.customerId !== userId) {
        return res.status(403).json({ message: "Forbidden: Cannot update another customer's vehicle documents" });
      }

      // Get the document to verify it belongs to this vehicle
      const [existingDoc] = await db.select()
        .from(vehicleDocuments)
        .where(eq(vehicleDocuments.id, req.params.documentId))
        .limit(1);

      if (!existingDoc) {
        return res.status(404).json({ message: "Document not found" });
      }

      if (existingDoc.vehicleId !== req.params.vehicleId) {
        return res.status(400).json({ message: "Document does not belong to this vehicle" });
      }

      // Parse and validate the update
      const data = {
        ...req.body,
        expiryDate: req.body.expiryDate ? new Date(req.body.expiryDate) : undefined,
      };

      const validated = updateVehicleDocumentSchema.parse(data);

      const [updated] = await db.update(vehicleDocuments)
        .set(validated)
        .where(eq(vehicleDocuments.id, req.params.documentId))
        .returning();

      res.json(updated);
    } catch (error) {
      console.error("Error updating vehicle document:", error);
      res.status(400).json({ message: "Failed to update vehicle document" });
    }
  });

  app.delete("/api/vehicles/:vehicleId/documents/:documentId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const currentUser = await storage.getUser(userId);
      const vehicle = await storage.getVehicle(req.params.vehicleId);

      if (!vehicle) {
        return res.status(404).json({ message: "Vehicle not found" });
      }

      // Authorization: customers can only delete their own vehicle documents, staff can delete any
      if (currentUser?.role === "customer" && vehicle.customerId !== userId) {
        return res.status(403).json({ message: "Forbidden: Cannot delete another customer's vehicle documents" });
      }

      // Get the document to verify it belongs to this vehicle
      const [existingDoc] = await db.select()
        .from(vehicleDocuments)
        .where(eq(vehicleDocuments.id, req.params.documentId))
        .limit(1);

      if (!existingDoc) {
        return res.status(404).json({ message: "Document not found" });
      }

      if (existingDoc.vehicleId !== req.params.vehicleId) {
        return res.status(400).json({ message: "Document does not belong to this vehicle" });
      }

      await db.delete(vehicleDocuments)
        .where(eq(vehicleDocuments.id, req.params.documentId));

      res.json({ message: "Document deleted successfully" });
    } catch (error) {
      console.error("Error deleting vehicle document:", error);
      res.status(500).json({ message: "Failed to delete vehicle document" });
    }
  });

  // Approval Requests
  app.get("/api/approvals/pending", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const approvals = await storage.getPendingApprovals();
      res.json(approvals);
    } catch (error) {
      console.error("Error fetching approvals:", error);
      res.status(500).json({ message: "Failed to fetch approvals" });
    }
  });

  app.post("/api/approvals", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      
      // Verify appointment belongs to the customer if appointmentId is provided
      if (req.body.appointmentId) {
        const appointment = await storage.getAppointment(req.body.appointmentId);
        if (!appointment || appointment.customerId !== userId) {
          return res.status(403).json({ message: "Forbidden: Cannot create approval for another customer's appointment" });
        }
      }
      
      // Force customerId to be the authenticated user
      const validated = insertApprovalRequestSchema.parse({
        ...req.body,
        customerId: userId,
      });
      const approval = await storage.createApprovalRequest(validated);
      
      // Send push notification to admin/managers
      const managers = await storage.getAllStaff();
      const adminManagers = managers.filter(m => 
        (m.role === 'admin' || m.role === 'manager') && m.isActive
      );
      if (adminManagers.length > 0) {
        const notification = pushNotificationService.createApprovalNotification({
          description: approval.reason || 'Approval request pending',
          estimatedCost: 0, // Approval requests don't have cost in current schema
        });
        pushNotificationService.sendToMultipleUsers(adminManagers, notification).catch(err => {
          console.error('Failed to send approval notification:', err);
        });
      }
      
      res.json(approval);
    } catch (error) {
      console.error("Error creating approval request:", error);
      res.status(400).json({ message: "Failed to create approval request" });
    }
  });

  app.patch("/api/approvals/:id", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const validated = updateApprovalSchema.parse(req.body);
      
      const updateData: any = {
        ...validated,
        reviewedBy: userId,
      };
      const approval = await storage.updateApprovalRequest(req.params.id, updateData);
      res.json(approval);
    } catch (error) {
      console.error("Error updating approval:", error);
      res.status(400).json({ message: "Failed to update approval" });
    }
  });

  // Customer Management (staff only)
  app.get("/api/customers/:id", isAuthenticated, requireRole(["admin", "manager", "mechanic", "receptionist"]), async (req: any, res) => {
    try {
      const customer = await storage.getCustomerById(req.params.id);
      if (!customer) {
        return res.status(404).json({ message: "Customer not found" });
      }
      res.json(customer);
    } catch (error) {
      console.error("Error fetching customer:", error);
      res.status(500).json({ message: "Failed to fetch customer" });
    }
  });

  app.get("/api/customers", isAuthenticated, requireRole(["admin", "manager", "mechanic", "receptionist"]), async (req: any, res) => {
    try {
      const {
        search,
        // Existing filters
        customerType, minSpent, maxSpent, minVisits, maxVisits, visitDateFrom, visitDateTo,
        // Quick Wins filters
        registrationDateFrom, registrationDateTo, accountStatus,
        minOutstandingBalance, maxOutstandingBalance,
        minLoyaltyPoints, maxLoyaltyPoints,
        minVehicles, maxVehicles,
        // Financial filters
        minOverdueInvoices, maxOverdueInvoices, paymentTerms,
        minCreditLimit, maxCreditLimit,
        minAvgInvoice, maxAvgInvoice,
        // Engagement filters
        emailVerified, hasMobileApp, hasSubmittedReviews, reviewRequestsEnabled,
        // Activity filters
        lastActivityFrom, lastActivityTo,
        minNoShowRate, maxNoShowRate,
        minCancellationRate, maxCancellationRate,
        serviceTypePreference
      } = req.query;

      const filters: CustomerFilters = {};

      // Existing filters
      if (customerType) filters.customerType = customerType as "individual" | "business";
      if (minSpent) filters.minSpent = parseFloat(minSpent as string);
      if (maxSpent) filters.maxSpent = parseFloat(maxSpent as string);
      if (minVisits) filters.minVisits = parseInt(minVisits as string);
      if (maxVisits) filters.maxVisits = parseInt(maxVisits as string);
      if (visitDateFrom) filters.visitDateFrom = new Date(visitDateFrom as string);
      if (visitDateTo) filters.visitDateTo = new Date(visitDateTo as string);

      // Quick Wins filters
      if (registrationDateFrom) filters.registrationDateFrom = new Date(registrationDateFrom as string);
      if (registrationDateTo) filters.registrationDateTo = new Date(registrationDateTo as string);
      if (accountStatus) filters.accountStatus = accountStatus as "active" | "inactive" | "all";
      if (minOutstandingBalance) filters.minOutstandingBalance = parseFloat(minOutstandingBalance as string);
      if (maxOutstandingBalance) filters.maxOutstandingBalance = parseFloat(maxOutstandingBalance as string);
      if (minLoyaltyPoints) filters.minLoyaltyPoints = parseFloat(minLoyaltyPoints as string);
      if (maxLoyaltyPoints) filters.maxLoyaltyPoints = parseFloat(maxLoyaltyPoints as string);
      if (minVehicles) filters.minVehicles = parseInt(minVehicles as string);
      if (maxVehicles) filters.maxVehicles = parseInt(maxVehicles as string);

      // Financial filters
      if (minOverdueInvoices) filters.minOverdueInvoices = parseInt(minOverdueInvoices as string);
      if (maxOverdueInvoices) filters.maxOverdueInvoices = parseInt(maxOverdueInvoices as string);
      if (paymentTerms) filters.paymentTerms = paymentTerms as string;
      if (minCreditLimit) filters.minCreditLimit = parseFloat(minCreditLimit as string);
      if (maxCreditLimit) filters.maxCreditLimit = parseFloat(maxCreditLimit as string);
      if (minAvgInvoice) filters.minAvgInvoice = parseFloat(minAvgInvoice as string);
      if (maxAvgInvoice) filters.maxAvgInvoice = parseFloat(maxAvgInvoice as string);

      // Engagement filters
      if (emailVerified !== undefined) filters.emailVerified = emailVerified === 'true';
      if (hasMobileApp !== undefined) filters.hasMobileApp = hasMobileApp === 'true';
      if (hasSubmittedReviews !== undefined) filters.hasSubmittedReviews = hasSubmittedReviews === 'true';
      if (reviewRequestsEnabled !== undefined) filters.reviewRequestsEnabled = reviewRequestsEnabled === 'true';

      // Activity filters
      if (lastActivityFrom) filters.lastActivityFrom = new Date(lastActivityFrom as string);
      if (lastActivityTo) filters.lastActivityTo = new Date(lastActivityTo as string);
      if (minNoShowRate) filters.minNoShowRate = parseFloat(minNoShowRate as string);
      if (maxNoShowRate) filters.maxNoShowRate = parseFloat(maxNoShowRate as string);
      if (minCancellationRate) filters.minCancellationRate = parseFloat(minCancellationRate as string);
      if (maxCancellationRate) filters.maxCancellationRate = parseFloat(maxCancellationRate as string);
      if (serviceTypePreference) filters.serviceTypePreference = serviceTypePreference as "in_shop" | "remote";

      // Always use searchCustomers to apply filters, even without search query
      const customers = await storage.searchCustomers(search as string || "", filters);

      res.json(customers);
    } catch (error) {
      console.error("Error fetching customers:", error);
      res.status(500).json({ message: "Failed to fetch customers" });
    }
  });

  app.get("/api/customers/:id/stats", isAuthenticated, requireRole(["admin", "manager", "mechanic", "receptionist"]), async (req: any, res) => {
    try {
      const stats = await storage.getCustomerStats(req.params.id);
      res.json(stats);
    } catch (error) {
      console.error("Error fetching customer stats:", error);
      res.status(500).json({ message: "Failed to fetch customer stats" });
    }
  });

  app.post("/api/customers", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req: any, res) => {
    try {
      const validated = insertCustomerSchema.parse(req.body);

      // Hash password if provided
      let customerData: any = { ...validated };
      if (validated.password) {
        customerData.password = await hashPassword(validated.password);
      }

      const customer = await storage.createCustomer(customerData);
      res.json(customer);
    } catch (error: any) {
      console.error("Error creating customer:", error);

      // Check for duplicate email constraint violation
      if (error?.code === '23505' && error?.constraint === 'users_email_unique') {
        return res.status(400).json({
          message: "A customer with this email already exists. Please use a different email address."
        });
      }

      res.status(400).json({ message: "Failed to create customer" });
    }
  });

  app.patch("/api/customers/:id", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req: any, res) => {
    try {
      const validated = insertCustomerSchema.parse(req.body);
      const customer = await storage.updateUser(req.params.id, validated);
      res.json(customer);
    } catch (error) {
      console.error("Error updating customer:", error);
      res.status(400).json({ message: "Failed to update customer" });
    }
  });

  app.delete("/api/customers/:id", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      await storage.deleteCustomer(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting customer:", error);
      res.status(500).json({ message: "Failed to delete customer" });
    }
  });

  app.post("/api/customers/bulk-delete", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids)) {
        return res.status(400).json({ message: "Invalid request: ids must be an array" });
      }
      await storage.bulkDeleteCustomers(ids);
      res.json({ success: true, count: ids.length });
    } catch (error) {
      console.error("Error bulk deleting customers:", error);
      res.status(500).json({ message: "Failed to bulk delete customers" });
    }
  });

  app.post("/api/customers/import", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const { data } = req.body;
      
      if (!Array.isArray(data)) {
        return res.status(400).json({ message: "Invalid data format" });
      }

      const results = {
        success: [] as any[],
        errors: [] as any[],
      };

      for (const row of data) {
        try {
          const validated = insertUserSchema.parse({
            firstName: row.firstName || row.first_name,
            lastName: row.lastName || row.last_name,
            email: row.email,
            phone: row.phone,
            address: row.address,
            customerType: row.customerType || row.customer_type || "individual",
          });
          
          const customer = await storage.createCustomer(validated);
          results.success.push(customer);
        } catch (error: any) {
          results.errors.push({
            row,
            error: error.message,
          });
        }
      }

      res.json(results);
    } catch (error) {
      console.error("Error importing customers:", error);
      res.status(500).json({ message: "Failed to import customers" });
    }
  });

  app.get("/api/customers/export", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req: any, res) => {
    try {
      const customers = await storage.getAllCustomers();
      const customerIds = customers.map(c => c.id);
      
      const statsMap = await storage.getBulkCustomerStats(customerIds);

      const exportData = customers.map((customer) => {
        const stats = statsMap.get(customer.id) || {
          totalSpent: 0,
          totalVisits: 0,
          lastVisitDate: null,
        };

        return {
          id: customer.id,
          firstName: customer.firstName,
          lastName: customer.lastName,
          email: customer.email,
          phone: customer.phone,
          address: customer.address,
          customerType: customer.customerType,
          totalSpent: stats.totalSpent,
          totalVisits: stats.totalVisits,
          lastVisitDate: stats.lastVisitDate,
          createdAt: customer.createdAt,
        };
      });

      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Customers");
      
      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
      
      res.setHeader("Content-Disposition", "attachment; filename=customers.xlsx");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.send(buffer);
    } catch (error) {
      console.error("Error exporting customers:", error);
      res.status(500).json({ message: "Failed to export customers" });
    }
  });

  // Customer Notes (staff only)
  app.get("/api/customers/:customerId/notes", isAuthenticated, requireRole(["admin", "manager", "mechanic", "receptionist"]), async (req: any, res) => {
    try {
      const notes = await storage.getNotesByCustomer(req.params.customerId);
      res.json(notes);
    } catch (error) {
      console.error("Error fetching notes:", error);
      res.status(500).json({ message: "Failed to fetch notes" });
    }
  });

  app.post("/api/customers/:customerId/notes", isAuthenticated, requireRole(["admin", "manager", "mechanic", "receptionist"]), async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const validated = insertCustomerNoteSchema.parse({
        customerId: req.params.customerId,
        authorId: userId,
        note: req.body.note,
      });
      const note = await storage.createCustomerNote(validated);
      res.json(note);
    } catch (error) {
      console.error("Error creating note:", error);
      res.status(400).json({ message: "Failed to create note" });
    }
  });

  // Job Card Timer
  app.get("/api/job-cards/:jobCardId/timer", isAuthenticated, requireRole(["admin", "manager", "mechanic"]), async (req: any, res) => {
    try {
      const session = await storage.getActiveTimerSession(req.params.jobCardId);
      res.json(session);
    } catch (error) {
      console.error("Error fetching timer session:", error);
      res.status(500).json({ message: "Failed to fetch timer session" });
    }
  });

  app.post("/api/job-cards/:jobCardId/timer", isAuthenticated, requireRole(["mechanic"]), async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      
      // Verify mechanic is assigned to this job card
      const jobCard = await storage.getJobCard(req.params.jobCardId);
      if (jobCard?.mechanicId !== userId) {
        return res.status(403).json({ message: "Forbidden: Can only track time on your own job cards" });
      }

      const validated = insertJobCardTimerSessionSchema.parse({
        ...req.body,
        jobCardId: req.params.jobCardId,
        mechanicId: userId,
      });
      const session = await storage.createTimerSession(validated);
      res.json(session);
    } catch (error) {
      console.error("Error creating timer session:", error);
      res.status(400).json({ message: "Failed to create timer session" });
    }
  });

  app.patch("/api/timer-sessions/:id", isAuthenticated, requireRole(["mechanic"]), async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      
      // First get the timer session by ID to verify ownership
      const sessionId = req.params.id;
      // Get session using a helper method
      const sessions = await storage.getJobCardTimerSessions(sessionId);
      const existingSession = sessions.find((s: any) => s.id === sessionId);
      
      if (!existingSession || existingSession.mechanicId !== userId) {
        return res.status(403).json({ message: "Forbidden: Can only update your own timer sessions" });
      }

      const { endTime, totalSeconds, isActive } = req.body;
      const session = await storage.updateTimerSession(sessionId, { endTime, totalSeconds, isActive });
      res.json(session);
    } catch (error) {
      console.error("Error updating timer session:", error);
      res.status(500).json({ message: "Failed to update timer session" });
    }
  });

  // Job Card Tasks
  app.get("/api/job-cards/:jobCardId/tasks", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const currentUser = await storage.getUser(userId);
      const jobCard = await storage.getJobCard(req.params.jobCardId);

      if (!jobCard) {
        return res.status(404).json({ message: "Job card not found" });
      }

      // Authorization: admin/manager can see all tasks, mechanic can see tasks for their job cards, customers can see tasks for their job cards
      if (currentUser?.role === "customer" && jobCard.customerId !== userId) {
        return res.status(403).json({ message: "Forbidden: Can only view tasks for your own job cards" });
      }

      if (currentUser?.role === "mechanic" && jobCard.mechanicId !== userId) {
        return res.status(403).json({ message: "Forbidden: Can only view tasks for your assigned job cards" });
      }

      const tasks = await storage.getTasksByJobCard(req.params.jobCardId);
      res.json(tasks);
    } catch (error) {
      console.error("Error fetching tasks:", error);
      res.status(500).json({ message: "Failed to fetch tasks" });
    }
  });

  app.post("/api/job-cards/:jobCardId/tasks", isAuthenticated, requireRole(["admin", "manager", "mechanic"]), async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const currentUser = await storage.getUser(userId);
      const jobCard = await storage.getJobCard(req.params.jobCardId);

      if (!jobCard) {
        return res.status(404).json({ message: "Job card not found" });
      }

      // Mechanics can only create tasks for their assigned job cards
      if (currentUser?.role === "mechanic" && jobCard.mechanicId !== userId) {
        return res.status(403).json({ message: "Forbidden: Can only create tasks for your assigned job cards" });
      }

      const validated = insertJobCardTaskSchema.parse({
        ...req.body,
        jobCardId: req.params.jobCardId,
      });
      const task = await storage.createTask(validated);
      res.json(task);
    } catch (error) {
      console.error("Error creating task:", error);
      res.status(400).json({ message: "Failed to create task" });
    }
  });

  app.patch("/api/tasks/:id", isAuthenticated, requireRole(["admin", "manager", "mechanic"]), async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const currentUser = await storage.getUser(userId);
      
      // Get the task by ID to verify ownership - SECURITY: Don't trust client-supplied jobCardId
      const task = await storage.getTask(req.params.id);

      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }

      const jobCard = await storage.getJobCard(task.jobCardId);
      
      if (!jobCard) {
        return res.status(404).json({ message: "Job card not found" });
      }

      // Mechanics can only update tasks for their assigned job cards
      if (currentUser?.role === "mechanic" && jobCard.mechanicId !== userId) {
        return res.status(403).json({ message: "Forbidden: Can only update tasks for your assigned job cards" });
      }

      // If marking as completed, set completedBy and completedAt
      const updateData = { ...req.body };
      if (req.body.isCompleted === true && !task.isCompleted) {
        updateData.completedBy = userId;
        updateData.completedAt = new Date();
      }

      // Remove jobCardId from update data to prevent tampering
      delete updateData.jobCardId;

      const validated = updateJobCardTaskSchema.parse(updateData);
      const updatedTask = await storage.updateTask(req.params.id, validated);
      res.json(updatedTask);
    } catch (error) {
      console.error("Error updating task:", error);
      res.status(400).json({ message: "Failed to update task" });
    }
  });

  app.delete("/api/tasks/:id", isAuthenticated, requireRole(["admin", "manager", "mechanic"]), async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const currentUser = await storage.getUser(userId);
      
      // Get the task by ID to verify ownership - SECURITY: Don't trust client-supplied jobCardId
      const task = await storage.getTask(req.params.id);

      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }

      const jobCard = await storage.getJobCard(task.jobCardId);
      
      if (!jobCard) {
        return res.status(404).json({ message: "Job card not found" });
      }

      // Mechanics can only delete tasks for their assigned job cards
      if (currentUser?.role === "mechanic" && jobCard.mechanicId !== userId) {
        return res.status(403).json({ message: "Forbidden: Can only delete tasks for your assigned job cards" });
      }

      await storage.deleteTask(req.params.id);
      res.json({ message: "Task deleted successfully" });
    } catch (error) {
      console.error("Error deleting task:", error);
      res.status(500).json({ message: "Failed to delete task" });
    }
  });

  // Landing Page Settings (public read, admin write)
  app.get("/api/landing-page", async (req, res) => {
    try {
      let settings = await storage.getLandingPageSettings();

      // If no settings exist, create default ones
      if (!settings) {
        settings = await storage.upsertLandingPageSettings({
          appName: "316 Auto",
          businessName: "316 Automotive",
          heroTitle: "Your Trusted Partner for Auto Repair & Maintenance",
          heroDescription: "Quality service, honest pricing, and expert care for your vehicle. Book your appointment online today.",
          heroButtonText: "Book Appointment",
          heroButtonUrl: "/register",
          servicesTitle: "Our Services",
          servicesDescription: "Comprehensive automotive services to keep your vehicle running smoothly",
          services: [],
          aboutTitle: "About Us",
          aboutDescription: "We are a family-owned automotive repair shop committed to providing exceptional service.",
          featuresTitle: "Why Choose Us",
          features: [],
          address: "316 Auto Street, Your City, ST 12345",
          phone: "(316) 555-0100",
          email: "service@316automotive.com",
          hours: "Mon-Fri: 7:00 AM - 6:00 PM, Sat: 8:00 AM - 4:00 PM",
          footerText: "© 2024 316 Automotive. All rights reserved.",
        });
      }

      res.json(settings);
    } catch (error) {
      console.error("Error fetching landing page settings:", error);
      res.status(500).json({ message: "Failed to fetch landing page settings" });
    }
  });

  app.patch("/api/landing-page/:id", isAuthenticated, requireRole(["admin"]), async (req: any, res) => {
    try {
      console.log("Updating landing page settings with data:", req.body);
      const settings = await storage.updateLandingPageSettings(req.params.id, req.body);

      if (!settings) {
        return res.status(404).json({ message: "Landing page settings not found" });
      }

      res.json(settings);
    } catch (error: any) {
      console.error("Error updating landing page settings:", error);
      console.error("Error details:", error.message, error.stack);
      res.status(400).json({ message: error.message || "Failed to update landing page settings" });
    }
  });

  // Pricing Settings (admin and manager access)
  app.get("/api/pricing-settings", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      let settings = await storage.getPricingSettings();

      // If no settings exist, return default values (will be created on first update)
      if (!settings) {
        settings = {
          id: 1,
          defaultLaborRate: "75.00",
          partsMarkupPercent: "30.00",
          taxRate: "8.00",
          shopSuppliesPercent: "5.00",
          diagnosticRate: "95.00",
          bodyworkRate: "85.00",
          performanceRate: "100.00",
          lowValuePartsMarkup: "40.00",
          mediumValuePartsMarkup: "30.00",
          highValuePartsMarkup: "20.00",
          lowValueThreshold: "50.00",
          highValueThreshold: "200.00",
          environmentalFee: "3.50",
          minimumServiceCharge: "50.00",
          updatedAt: new Date(),
        } as PricingSettings;
      }

      res.json(settings);
    } catch (error) {
      console.error("Error fetching pricing settings:", error);
      res.status(500).json({ message: "Failed to fetch pricing settings" });
    }
  });

  app.patch("/api/pricing-settings", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const settings = await storage.updatePricingSettings(req.body);
      res.json(settings);
    } catch (error) {
      console.error("Error updating pricing settings:", error);
      res.status(400).json({ message: "Failed to update pricing settings" });
    }
  });

  // Email Settings
  app.get("/api/settings/email", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const settings = await storage.getEmailSettings();
      
      if (settings) {
        // Mask the API key for security (show only last 4 characters)
        const maskedSettings = {
          ...settings,
          resendApiKey: settings.resendApiKey 
            ? `${'*'.repeat(Math.max(0, settings.resendApiKey.length - 4))}${settings.resendApiKey.slice(-4)}`
            : null
        };
        res.json(maskedSettings);
      } else {
        res.json(null);
      }
    } catch (error) {
      console.error("Error fetching email settings:", error);
      res.status(500).json({ message: "Failed to fetch email settings" });
    }
  });

  app.patch("/api/settings/email", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const { resendApiKey, fromEmail, fromName } = req.body;
      
      const updateData: any = {};
      
      // Only update fields that are provided
      if (fromEmail !== undefined) updateData.fromEmail = fromEmail;
      if (fromName !== undefined) updateData.fromName = fromName;
      
      // Only update API key if it doesn't contain asterisks (not masked)
      if (resendApiKey && !resendApiKey.includes('*')) {
        updateData.resendApiKey = resendApiKey;
      }
      
      const settings = await storage.updateEmailSettings(updateData);
      
      if (settings) {
        // Mask the API key in the response
        const maskedSettings = {
          ...settings,
          resendApiKey: settings.resendApiKey 
            ? `${'*'.repeat(Math.max(0, settings.resendApiKey.length - 4))}${settings.resendApiKey.slice(-4)}`
            : null
        };
        res.json(maskedSettings);
      } else {
        res.status(404).json({ message: "Failed to update email settings" });
      }
    } catch (error) {
      console.error("Error updating email settings:", error);
      res.status(400).json({ message: "Failed to update email settings" });
    }
  });

  // Invoices
  app.get("/api/invoices", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const currentUser = await storage.getUser(userId);
      const { customerId } = req.query;
      
      if (currentUser?.role === "customer") {
        const invoices = await storage.getInvoicesByCustomer(userId);
        res.json(invoices);
      } else if (customerId) {
        // Staff can filter by customer ID
        const invoices = await storage.getInvoicesByCustomer(customerId as string);
        res.json(invoices);
      } else {
        const invoices = await storage.getAllInvoices();
        res.json(invoices);
      }
    } catch (error) {
      console.error("Error fetching invoices:", error);
      res.status(500).json({ message: "Failed to fetch invoices" });
    }
  });

  app.get("/api/invoices/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const currentUser = await storage.getUser(userId);
      const invoice = await storage.getInvoice(req.params.id);
      
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      
      // Customers can only view their own invoices
      if (currentUser?.role === "customer" && invoice.customerId !== userId) {
        return res.status(403).json({ message: "Forbidden: Cannot view another customer's invoice" });
      }
      
      res.json(invoice);
    } catch (error) {
      console.error("Error fetching invoice:", error);
      res.status(500).json({ message: "Failed to fetch invoice" });
    }
  });

  app.get("/api/invoices/:id/items", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const currentUser = await storage.getUser(userId);
      const invoice = await storage.getInvoice(req.params.id);
      
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      
      // Customers can only view items for their own invoices
      if (currentUser?.role === "customer" && invoice.customerId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      const items = await storage.getInvoiceItems(req.params.id);
      res.json(items);
    } catch (error) {
      console.error("Error fetching invoice items:", error);
      res.status(500).json({ message: "Failed to fetch invoice items" });
    }
  });

  // Generate share token for invoice (staff only)
  app.post("/api/invoices/:id/share-token", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req: any, res) => {
    try {
      const invoice = await storage.getInvoice(req.params.id);

      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      // Generate a unique share token (hard to guess)
      const crypto = await import("crypto");
      const shareToken = crypto.randomBytes(32).toString("hex");

      // Update invoice with share token
      const updatedInvoice = await storage.updateInvoice(req.params.id, { shareToken });

      if (!updatedInvoice) {
        return res.status(500).json({ message: "Failed to update invoice" });
      }

      res.json({ shareToken: updatedInvoice.shareToken });
    } catch (error) {
      console.error("Error generating share token:", error);
      res.status(500).json({ message: "Failed to generate share token" });
    }
  });

  // Generate PDF for invoice (staff and customer with access)
  app.get("/api/invoices/:id/pdf", isAuthenticated, async (req: any, res) => {
    try {
      const invoice = await storage.getInvoice(req.params.id);

      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      // Check authorization: staff or invoice owner
      const isStaff = ["admin", "manager", "receptionist", "mechanic"].includes(req.user.role);
      const isOwner = invoice.customerId === req.user.id;

      if (!isStaff && !isOwner) {
        return res.status(403).json({ message: "Not authorized to access this invoice" });
      }

      // Import PDF generator
      const { generatePDFFromURL } = await import("./pdfGenerator");

      // Get the print URL - use internal server URL to avoid external network calls
      const protocol = req.protocol;
      const host = req.get('host');
      const printUrl = `${protocol}://${host}/invoices/${req.params.id}/print`;

      // Generate PDF using Puppeteer
      const pdfBuffer = await generatePDFFromURL(
        printUrl,
        {
          name: 'connect.sid', // Express session cookie name
          value: req.sessionID,
          domain: new URL(`${protocol}://${host}`).hostname,
        },
        {
          format: 'Letter',
          waitForSelector: '#invoice-template',
        }
      );

      // Set response headers for PDF download
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Invoice_${invoice.invoiceNumber}.pdf"`);
      res.setHeader('Content-Length', pdfBuffer.length);

      res.send(pdfBuffer);
    } catch (error) {
      console.error("Error generating PDF:", error);
      res.status(500).json({ message: "Failed to generate PDF" });
    }
  });

  // Email invoice with PDF attachment (staff only)
  app.post("/api/invoices/:id/email", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req: any, res) => {
    try {
      const invoice = await storage.getInvoice(req.params.id);

      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      // Get customer information
      const customer = await storage.getUserById(invoice.customerId);
      if (!customer) {
        return res.status(404).json({ message: "Customer not found" });
      }

      // Check if customer has email
      if (!customer.email && !customer.billingEmail) {
        return res.status(400).json({ message: "Customer does not have an email address configured" });
      }

      // Get business settings
      const businessInfo = await storage.getLandingPageSettings();
      const pricingSettings = await storage.getPricingSettings();

      // Import PDF generator and email service
      const { generatePDFFromURL } = await import("./pdfGenerator");
      const { sendInvoiceEmail } = await import("./email");

      // Get the print URL - use internal server URL
      const protocol = req.protocol;
      const host = req.get('host');
      const printUrl = `${protocol}://${host}/invoices/${req.params.id}/print`;

      // Generate PDF using Puppeteer
      const pdfBuffer = await generatePDFFromURL(
        printUrl,
        {
          name: 'connect.sid',
          value: req.sessionID,
          domain: new URL(`${protocol}://${host}`).hostname,
        },
        {
          format: 'Letter',
          waitForSelector: '#invoice-template',
        }
      );

      // Send email with PDF attachment
      const result = await sendInvoiceEmail({
        customer,
        invoiceNumber: invoice.invoiceNumber,
        invoiceTotal: invoice.total,
        dueDate: new Date(invoice.dueDate).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
        pdfBuffer,
        businessName: businessInfo?.businessName || '316 Automotive',
        currencySymbol: pricingSettings?.currencySymbol || '$',
      });

      if (!result.success) {
        return res.status(500).json({ message: result.error || "Failed to send invoice email" });
      }

      res.json({
        message: "Invoice email sent successfully",
        messageId: result.messageId,
      });
    } catch (error) {
      console.error("Error sending invoice email:", error);
      res.status(500).json({ message: "Failed to send invoice email" });
    }
  });

  // Public invoice view (no authentication required) - requires share token for security
  app.get("/api/invoices/public/:shareToken", async (req: any, res) => {
    try {
      // Find invoice by share token
      const invoices = await storage.getAllInvoices();
      const invoice = invoices.find(inv => inv.shareToken === req.params.shareToken);
      
      if (!invoice || !invoice.shareToken) {
        return res.status(404).json({ message: "Invoice not found or not shared" });
      }
      
      // Get invoice items
      const items = await storage.getInvoiceItems(invoice.id);
      
      // Get customer info
      const customer = await storage.getUser(invoice.customerId);
      
      // Get business info from landing page settings
      const settings = await storage.getLandingPageSettings();
      const businessInfo = settings ? {
        businessName: settings.businessName,
        address: settings.address || "",
        phone: settings.phone || "",
        email: settings.email || "",
      } : {
        businessName: "316 Automotive",
        address: "",
        phone: "",
        email: "",
      };
      
      // Return all data needed for public view
      res.json({
        invoice,
        items,
        customer: customer ? {
          firstName: customer.firstName,
          lastName: customer.lastName,
          email: customer.email,
        } : null,
        businessInfo,
      });
    } catch (error) {
      console.error("Error fetching public invoice:", error);
      res.status(500).json({ message: "Failed to fetch invoice" });
    }
  });

  app.post("/api/invoices", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const { items, ...invoiceData } = req.body;
      
      // Convert invoice data types (dates and decimals)
      const processedInvoiceData = {
        ...invoiceData,
        dueDate: invoiceData.dueDate ? new Date(invoiceData.dueDate) : undefined,
        issueDate: invoiceData.issueDate ? new Date(invoiceData.issueDate) : undefined,
        subtotal: invoiceData.subtotal !== undefined ? String(invoiceData.subtotal) : undefined,
        tax: invoiceData.tax !== undefined ? String(invoiceData.tax) : undefined,
        total: invoiceData.total !== undefined ? String(invoiceData.total) : undefined,
      };
      
      // Convert item data types (decimals) and remove invoiceId if present
      const processedItems = items && Array.isArray(items) 
        ? items.map((item: any) => {
            const { invoiceId, ...itemData } = item; // Remove invoiceId as it will be set by createInvoiceWithItems
            return {
              ...itemData,
              quantity: itemData.quantity !== undefined ? String(itemData.quantity) : undefined,
              unitPrice: itemData.unitPrice !== undefined ? String(itemData.unitPrice) : undefined,
              total: itemData.total !== undefined ? String(itemData.total) : undefined,
            };
          })
        : [];
      
      // Validate items (without invoiceId as it hasn't been created yet)
      const itemSchema = insertInvoiceItemSchema.omit({ invoiceId: true });
      const validatedItems = processedItems.map((item: any) => itemSchema.parse(item));
      
      // Generate invoice number
      const invoiceNumber = await storage.generateInvoiceNumber();
      
      // Validate invoice data
      const validated = insertInvoiceSchema.parse({
        ...processedInvoiceData,
        invoiceNumber,
      });
      
      // Create invoice and items atomically in a transaction
      // Items will get their invoiceId set by createInvoiceWithItems
      const invoice = await storage.createInvoiceWithItems(validated, validatedItems as any);
      
      // Send push notification to customer
      const customer = await storage.getUser(invoice.customerId);
      if (customer) {
        const notification = pushNotificationService.createInvoiceNotification({
          invoiceNumber: invoice.invoiceNumber,
          total: parseFloat(invoice.total || '0'),
        });
        pushNotificationService.sendToUser(customer, notification).catch(err => {
          console.error('Failed to send invoice notification:', err);
        });
      }
      
      res.json(invoice);
    } catch (error) {
      console.error("Error creating invoice:", error);
      res.status(400).json({ message: "Failed to create invoice" });
    }
  });

  app.patch("/api/invoices/:id", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const validated = updateInvoiceSchema.parse(req.body);
      const invoice = await storage.updateInvoice(req.params.id, validated);
      res.json(invoice);
    } catch (error) {
      console.error("Error updating invoice:", error);
      res.status(400).json({ message: "Failed to update invoice" });
    }
  });

  // Payments
  app.get("/api/invoices/:invoiceId/payments", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const currentUser = await storage.getUser(userId);
      const invoice = await storage.getInvoice(req.params.invoiceId);
      
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      
      // Customers can only view payments for their own invoices
      if (currentUser?.role === "customer" && invoice.customerId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      const payments = await storage.getPaymentsByInvoice(req.params.invoiceId);
      res.json(payments);
    } catch (error) {
      console.error("Error fetching payments:", error);
      res.status(500).json({ message: "Failed to fetch payments" });
    }
  });

  app.post("/api/invoices/:invoiceId/payments", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);

      // Generate payment number
      const paymentNumber = await storage.generatePaymentNumber();

      const validated = insertPaymentSchema.parse({
        ...req.body,
        invoiceId: req.params.invoiceId,
        paymentNumber,
        createdBy: userId,
      });

      const payment = await storage.createPayment(validated);

      // Storage method automatically updates invoice status and balance
      // Check if invoice is now fully paid for loyalty points
      const invoice = await storage.getInvoice(req.params.invoiceId);

      if (invoice && invoice.status === "paid") {
        // Award loyalty points for the completed service visit
        const existingTransactions = await storage.getPointsTransactions(invoice.customerId);
        const alreadyAwarded = existingTransactions.some(t => t.relatedId === req.params.invoiceId);

        if (!alreadyAwarded) {
          const loyaltySettings = await storage.getLoyaltySettings();
          const pointsPerDollar = loyaltySettings?.pointsPerDollar || 1;
          const pointsPerVisit = loyaltySettings?.pointsPerVisit || 50;

          const dollarPoints = Math.floor(parseFloat(invoice.total) * parseFloat(pointsPerDollar.toString()));
          const totalPoints = dollarPoints + pointsPerVisit;

          await storage.addPointsTransaction({
            customerId: invoice.customerId,
            points: totalPoints,
            type: "earned",
            description: `Service visit reward - Invoice ${invoice.invoiceNumber}`,
            relatedId: req.params.invoiceId,
          });
        }
      }
      
      res.json(payment);
    } catch (error) {
      console.error("Error creating payment:", error);
      res.status(400).json({ message: "Failed to create payment" });
    }
  });

  // Estimates
  app.get("/api/estimates", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const currentUser = await storage.getUser(userId);
      
      let estimates;
      if (currentUser?.role === "customer") {
        estimates = await storage.getEstimatesByCustomer(userId);
      } else {
        estimates = await storage.getAllEstimates();
      }
      
      res.json(estimates);
    } catch (error) {
      console.error("Error fetching estimates:", error);
      res.status(500).json({ message: "Failed to fetch estimates" });
    }
  });

  app.get("/api/estimates/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const currentUser = await storage.getUser(userId);
      const estimate = await storage.getEstimate(req.params.id);
      
      if (!estimate) {
        return res.status(404).json({ message: "Estimate not found" });
      }
      
      // Customers can only view their own estimates
      if (currentUser?.role === "customer" && estimate.customerId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      res.json(estimate);
    } catch (error) {
      console.error("Error fetching estimate:", error);
      res.status(500).json({ message: "Failed to fetch estimate" });
    }
  });

  app.get("/api/estimates/:id/items", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const currentUser = await storage.getUser(userId);
      const estimate = await storage.getEstimate(req.params.id);
      
      if (!estimate) {
        return res.status(404).json({ message: "Estimate not found" });
      }
      
      // Customers can only view their own estimate items
      if (currentUser?.role === "customer" && estimate.customerId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      const items = await storage.getEstimateItems(req.params.id);
      res.json(items);
    } catch (error) {
      console.error("Error fetching estimate items:", error);
      res.status(500).json({ message: "Failed to fetch estimate items" });
    }
  });

  app.post("/api/estimates", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const { items, ...estimateData } = req.body;
      
      // Generate estimate number
      const estimateNumber = await storage.generateEstimateNumber();
      
      // Create estimate with items
      const estimate = await storage.createEstimateWithItems(
        {
          ...estimateData,
          estimateNumber,
          issueDate: new Date(estimateData.issueDate),
          expiryDate: new Date(estimateData.expiryDate),
        },
        items || []
      );
      
      res.status(201).json(estimate);
    } catch (error) {
      console.error("Error creating estimate:", error);
      res.status(400).json({ message: "Failed to create estimate" });
    }
  });

  app.patch("/api/estimates/:id", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const validated = updateEstimateSchema.parse(req.body);
      const estimate = await storage.updateEstimate(req.params.id, validated);
      res.json(estimate);
    } catch (error) {
      console.error("Error updating estimate:", error);
      res.status(400).json({ message: "Failed to update estimate" });
    }
  });

  app.post("/api/estimates/:id/convert", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const invoice = await storage.convertEstimateToInvoice(req.params.id);
      res.status(201).json(invoice);
    } catch (error) {
      console.error("Error converting estimate to invoice:", error);
      res.status(400).json({ message: "Failed to convert estimate to invoice" });
    }
  });

  // Email Campaigns
  app.get("/api/campaigns", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const { status } = req.query;
      const campaigns = status 
        ? await storage.getEmailCampaignsByStatus(status)
        : await storage.getAllEmailCampaigns();
      res.json(campaigns);
    } catch (error) {
      console.error("Error fetching campaigns:", error);
      res.status(500).json({ message: "Failed to fetch campaigns" });
    }
  });

  app.get("/api/campaigns/:id", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const campaign = await storage.getEmailCampaign(req.params.id);
      if (!campaign) {
        return res.status(404).json({ message: "Campaign not found" });
      }
      res.json(campaign);
    } catch (error) {
      console.error("Error fetching campaign:", error);
      res.status(500).json({ message: "Failed to fetch campaign" });
    }
  });

  app.post("/api/campaigns", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      
      // Preprocess: Convert scheduledFor ISO string to Date object
      const processedBody = {
        ...req.body,
        scheduledFor: req.body.scheduledFor ? new Date(req.body.scheduledFor) : undefined,
        sentBy: userId,
        status: req.body.status || "draft",
      };
      
      const validated = insertEmailCampaignSchema.parse(processedBody);
      const campaign = await storage.createEmailCampaign(validated);
      res.json(campaign);
    } catch (error) {
      console.error("Error creating campaign:", error);
      res.status(400).json({ message: "Failed to create campaign" });
    }
  });

  app.patch("/api/campaigns/:id", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      // Preprocess: Convert scheduledFor ISO string to Date object
      const processedBody = {
        ...req.body,
        scheduledFor: req.body.scheduledFor ? new Date(req.body.scheduledFor) : undefined,
      };
      
      const validated = updateEmailCampaignSchema.parse(processedBody);
      const campaign = await storage.updateEmailCampaign(req.params.id, validated);
      if (!campaign) {
        return res.status(404).json({ message: "Campaign not found" });
      }
      res.json(campaign);
    } catch (error) {
      console.error("Error updating campaign:", error);
      res.status(400).json({ message: "Failed to update campaign" });
    }
  });

  app.post("/api/campaigns/:id/send", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const campaign = await storage.getEmailCampaign(req.params.id);
      if (!campaign) {
        return res.status(404).json({ message: "Campaign not found" });
      }

      // Validate campaign status - only draft or scheduled campaigns can be sent
      if (campaign.status === "sent") {
        return res.status(400).json({ message: "Campaign has already been sent" });
      }

      if (campaign.status !== "draft" && campaign.status !== "scheduled") {
        return res.status(400).json({ message: "Campaign cannot be sent in its current status" });
      }

      // Get recipients based on campaign target
      const customers = await storage.getAllCustomers();
      
      let sentCount = 0;
      const errors: string[] = [];

      // Send emails to all customers
      for (const customer of customers) {
        try {
          if (!customer.email) continue;
          
          // Get customer's vehicles for personalization
          const vehicles = await storage.getVehiclesByCustomer(customer.id);
          const primaryVehicle = vehicles[0];
          
          const fullName = [customer.firstName, customer.lastName].filter(Boolean).join(' ');
          
          await sendCampaignEmail({
            to: customer.email,
            subject: campaign.subject,
            htmlTemplate: campaign.htmlContent,
            plainTextTemplate: campaign.plainText || undefined,
            personalizationData: {
              customerName: fullName || customer.email,
              firstName: customer.firstName || 'Valued Customer',
              lastName: customer.lastName || '',
              email: customer.email,
              phone: customer.phone || '',
              accountNumber: customer.accountNumber || '',
              vehicleMake: primaryVehicle?.make || '',
              vehicleModel: primaryVehicle?.model || '',
              vehicleYear: primaryVehicle?.year ? Number(primaryVehicle.year) : undefined,
              lastVisitDate: '',
            }
          });
          sentCount++;
        } catch (error) {
          errors.push(`Failed to send to ${customer.email}: ${error}`);
        }
      }

      // Update campaign with sent status and count
      await storage.updateEmailCampaign(req.params.id, {
        status: "sent",
        sentCount,
      });

      res.json({ 
        success: true, 
        sentCount, 
        errors: errors.length > 0 ? errors : undefined 
      });
    } catch (error) {
      console.error("Error sending campaign:", error);
      res.status(500).json({ message: "Failed to send campaign" });
    }
  });

  // Email Settings
  app.get("/api/email/connection", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const { checkEmailConnection } = await import("./email");
      const connectionStatus = await checkEmailConnection();
      res.json(connectionStatus);
    } catch (error) {
      console.error("Error checking email connection:", error);
      res.status(500).json({ 
        connected: false, 
        error: error instanceof Error ? error.message : "Failed to check connection" 
      });
    }
  });

  // Coupons
  app.get("/api/coupons", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const currentUser = await storage.getUser(userId);
      
      // Admin/manager see all, customers see active coupons
      const coupons = (currentUser?.role === "admin" || currentUser?.role === "manager")
        ? await storage.getAllCoupons()
        : await storage.getActiveCoupons();
      
      res.json(coupons);
    } catch (error) {
      console.error("Error fetching coupons:", error);
      res.status(500).json({ message: "Failed to fetch coupons" });
    }
  });

  app.post("/api/coupons", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      
      // Preprocess: Convert expiryDate ISO string to Date object
      const processedBody = {
        ...req.body,
        expiryDate: req.body.expiryDate ? new Date(req.body.expiryDate) : undefined,
        createdBy: userId,
      };
      
      const validated = insertCouponSchema.parse(processedBody);
      const coupon = await storage.createCoupon(validated);
      res.json(coupon);
    } catch (error) {
      console.error("Error creating coupon:", error);
      res.status(400).json({ message: "Failed to create coupon" });
    }
  });

  app.get("/api/coupons/:code/validate", isAuthenticated, async (req: any, res) => {
    try {
      const coupon = await storage.getCouponByCode(req.params.code);
      
      if (!coupon) {
        return res.status(404).json({ valid: false, message: "Coupon not found" });
      }

      if (!coupon.isActive) {
        return res.status(400).json({ valid: false, message: "Coupon is inactive" });
      }

      if (new Date() > new Date(coupon.expiryDate)) {
        return res.status(400).json({ valid: false, message: "Coupon has expired" });
      }

      if (coupon.usedBy) {
        return res.status(400).json({ valid: false, message: "Coupon has already been used" });
      }

      res.json({ valid: true, coupon });
    } catch (error) {
      console.error("Error validating coupon:", error);
      res.status(500).json({ message: "Failed to validate coupon" });
    }
  });

  app.post("/api/coupons/:code/redeem", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const { invoiceId } = req.body;

      if (!invoiceId) {
        return res.status(400).json({ message: "Invoice ID is required" });
      }

      // Validate coupon first
      const coupon = await storage.getCouponByCode(req.params.code);
      
      if (!coupon || !coupon.isActive || new Date() > new Date(coupon.expiryDate) || coupon.usedBy) {
        return res.status(400).json({ message: "Invalid or expired coupon" });
      }

      // Redeem the coupon
      const redeemedCoupon = await storage.redeemCoupon(req.params.code, userId, invoiceId);
      res.json(redeemedCoupon);
    } catch (error) {
      console.error("Error redeeming coupon:", error);
      res.status(500).json({ message: "Failed to redeem coupon" });
    }
  });

  // Loyalty Points
  app.get("/api/loyalty/balance", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const balance = await storage.getCustomerPointsBalance(userId);
      res.json({ balance });
    } catch (error) {
      console.error("Error fetching points balance:", error);
      res.status(500).json({ message: "Failed to fetch points balance" });
    }
  });

  app.get("/api/loyalty/transactions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const transactions = await storage.getPointsTransactions(userId);
      res.json(transactions);
    } catch (error) {
      console.error("Error fetching transactions:", error);
      res.status(500).json({ message: "Failed to fetch transactions" });
    }
  });

  app.post("/api/loyalty/transactions", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const validated = insertLoyaltyPointsTransactionSchema.parse(req.body);
      const transaction = await storage.addPointsTransaction(validated);
      res.json(transaction);
    } catch (error) {
      console.error("Error adding transaction:", error);
      res.status(400).json({ message: "Failed to add transaction" });
    }
  });

  app.get("/api/loyalty/settings", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const settings = await storage.getLoyaltySettings();
      res.json(settings);
    } catch (error) {
      console.error("Error fetching loyalty settings:", error);
      res.status(500).json({ message: "Failed to fetch loyalty settings" });
    }
  });

  app.patch("/api/loyalty/settings", isAuthenticated, requireRole(["admin"]), async (req: any, res) => {
    try {
      const validated = insertLoyaltySettingsSchema.partial().parse(req.body);
      const settings = await storage.updateLoyaltySettings(validated);
      res.json(settings);
    } catch (error) {
      console.error("Error updating loyalty settings:", error);
      res.status(400).json({ message: "Failed to update loyalty settings" });
    }
  });

  app.post("/api/loyalty/convert-to-coupon", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const { points } = req.body;

      if (!points || points <= 0) {
        return res.status(400).json({ message: "Invalid points amount" });
      }

      // Get loyalty settings for conversion rate and minimum threshold
      const loyaltySettings = await storage.getLoyaltySettings();
      const pointsToCouponRate = loyaltySettings?.pointsToCouponRate || 100; // Points needed for $1
      const minRedemptionPoints = loyaltySettings?.minRedemptionPoints || 500; // Minimum points to redeem

      // Check minimum redemption threshold
      if (points < minRedemptionPoints) {
        return res.status(400).json({ 
          message: `Minimum redemption is ${minRedemptionPoints} points` 
        });
      }

      // Check customer's balance
      const balance = await storage.getCustomerPointsBalance(userId);
      if (balance < points) {
        return res.status(400).json({ message: "Insufficient points balance" });
      }

      // Calculate coupon value using configured conversion rate
      const couponValue = (points / pointsToCouponRate).toFixed(2);

      // Generate unique coupon code
      const couponCode = `LOYALTY-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

      // Create coupon (expires in 90 days)
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + 90);

      const coupon = await storage.createCoupon({
        code: couponCode,
        type: "fixed",
        value: couponValue,
        minPurchase: "0",
        expiryDate,
        isActive: true,
        createdBy: userId,
      });

      // Deduct points from customer's balance
      await storage.addPointsTransaction({
        customerId: userId,
        points: -points,
        type: "redeemed",
        description: `Converted ${points} points to coupon ${couponCode} ($${couponValue})`,
        relatedId: coupon.id,
      });

      res.json({ code: couponCode, value: couponValue, expiryDate });
    } catch (error) {
      console.error("Error converting points:", error);
      res.status(500).json({ message: "Failed to convert points to coupon" });
    }
  });

  // Customer Referrals
  app.get("/api/referrals/my-referrals", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const referrals = await storage.getReferralsByReferrer(userId);
      res.json(referrals);
    } catch (error) {
      console.error("Error fetching referrals:", error);
      res.status(500).json({ message: "Failed to fetch referrals" });
    }
  });

  app.post("/api/referrals", isAuthenticated, async (req: any, res) => {
    try {
      const validated = insertCustomerReferralSchema.parse(req.body);
      const referral = await storage.createReferral(validated);
      res.json(referral);
    } catch (error) {
      console.error("Error creating referral:", error);
      res.status(400).json({ message: "Failed to create referral" });
    }
  });

  // Referral Code Endpoints
  app.get("/api/users/me/referral-code", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const user = await storage.getUser(userId);

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Generate referral code if user doesn't have one
      if (!user.referralCode) {
        const { generateUniqueReferralCode, generateReferralLink } = await import("./referralCodeGenerator");
        const referralCode = await generateUniqueReferralCode(user.firstName);
        await storage.updateUserReferralCode(userId, referralCode);

        const referralLink = generateReferralLink(referralCode);
        const stats = await storage.getReferralStats(userId);

        return res.json({
          referralCode,
          referralLink,
          ...stats,
        });
      }

      // Return existing referral code
      const { generateReferralLink } = await import("./referralCodeGenerator");
      const referralLink = generateReferralLink(user.referralCode);
      const stats = await storage.getReferralStats(userId);

      res.json({
        referralCode: user.referralCode,
        referralLink,
        ...stats,
      });
    } catch (error) {
      console.error("Error fetching referral code:", error);
      res.status(500).json({ message: "Failed to fetch referral code" });
    }
  });

  app.get("/api/referrals/validate/:code", async (req: any, res) => {
    try {
      const { code } = req.params;

      // Validate code format
      const { isValidReferralCodeFormat } = await import("./referralCodeGenerator");
      if (!isValidReferralCodeFormat(code)) {
        return res.status(400).json({
          valid: false,
          message: "Invalid referral code format"
        });
      }

      // Find user with this referral code
      const referrer = await storage.getUserByReferralCode(code);

      if (!referrer) {
        return res.json({
          valid: false,
          message: "Referral code not found"
        });
      }

      // Return referrer info (without sensitive data)
      res.json({
        valid: true,
        referrerName: `${referrer.firstName || ''} ${referrer.lastName || ''}`.trim() || 'A customer',
        message: "Valid referral code",
      });
    } catch (error) {
      console.error("Error validating referral code:", error);
      res.status(500).json({ message: "Failed to validate referral code" });
    }
  });

  // Vehicle Inspections
  app.get("/api/inspections", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const currentUser = await storage.getUser(userId);
      
      let inspections;
      if (currentUser?.role === "customer") {
        inspections = await storage.getInspectionsByCustomer(userId);
      } else {
        inspections = await storage.getAllInspections();
      }
      
      // Hydrate with vehicle, customer, and mechanic data
      const inspectionsWithRelations = await Promise.all(
        inspections.map(async (inspection) => {
          const [vehicle, customer, mechanic] = await Promise.all([
            inspection.vehicleId ? storage.getVehicle(inspection.vehicleId) : Promise.resolve(null),
            inspection.customerId ? storage.getUser(inspection.customerId) : Promise.resolve(null),
            inspection.mechanicId ? storage.getUser(inspection.mechanicId) : Promise.resolve(null),
          ]);
          
          return {
            ...inspection,
            vehicle: vehicle || undefined,
            customer: customer || undefined,
            mechanic: mechanic || undefined,
          };
        })
      );
      
      res.json(inspectionsWithRelations);
    } catch (error) {
      console.error("Error fetching inspections:", error);
      res.status(500).json({ message: "Failed to fetch inspections" });
    }
  });

  app.get("/api/inspections/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const currentUser = await storage.getUser(userId);
      const inspection = await storage.getInspection(req.params.id);
      
      if (!inspection) {
        return res.status(404).json({ message: "Inspection not found" });
      }
      
      // Customers can only view their own inspections
      if (currentUser?.role === "customer" && inspection.customerId !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      res.json(inspection);
    } catch (error) {
      console.error("Error fetching inspection:", error);
      res.status(500).json({ message: "Failed to fetch inspection" });
    }
  });

  app.get("/api/inspections/:id/items", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const currentUser = await storage.getUser(userId);
      const inspection = await storage.getInspection(req.params.id);
      
      if (!inspection) {
        return res.status(404).json({ message: "Inspection not found" });
      }
      
      // Customers can only view items for their own inspections
      if (currentUser?.role === "customer" && inspection.customerId !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const items = await storage.getInspectionItems(req.params.id);
      res.json(items);
    } catch (error) {
      console.error("Error fetching inspection items:", error);
      res.status(500).json({ message: "Failed to fetch inspection items" });
    }
  });

  app.post("/api/inspections", isAuthenticated, requireRole(["admin", "manager", "mechanic"]), async (req: any, res) => {
    try {
      const { items, ...inspectionData } = req.body;
      
      // Validate inspection data
      const validatedInspection = insertInspectionSchema.parse(inspectionData);
      
      // Validate items if present
      const validatedItems = items ? items.map((item: any) => insertInspectionItemSchema.parse(item)) : [];
      
      // Generate inspection number
      const inspectionNumber = await storage.generateInspectionNumber();
      
      // Create inspection with items
      const inspection = await storage.createInspectionWithItems(
        { ...validatedInspection, inspectionNumber },
        validatedItems
      );
      
      res.status(201).json(inspection);
    } catch (error) {
      console.error("Error creating inspection:", error);
      res.status(400).json({ message: "Failed to create inspection" });
    }
  });

  app.patch("/api/inspections/:id", isAuthenticated, requireRole(["admin", "manager", "mechanic"]), async (req: any, res) => {
    try {
      const validated = updateInspectionSchema.parse(req.body);
      const inspection = await storage.updateInspection(req.params.id, validated);
      res.json(inspection);
    } catch (error) {
      console.error("Error updating inspection:", error);
      res.status(400).json({ message: "Failed to update inspection" });
    }
  });

  app.delete("/api/inspections/:id", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const inspection = await storage.getInspection(req.params.id);
      if (!inspection) {
        return res.status(404).json({ message: "Inspection not found" });
      }

      // Delete inspection items first
      await storage.deleteInspectionItems(req.params.id);

      res.status(204).send();
    } catch (error) {
      console.error("Error deleting inspection:", error);
      res.status(500).json({ message: "Failed to delete inspection" });
    }
  });

  // Staff Reviews
  app.post("/api/reviews", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const currentUser = await storage.getUser(userId);

      // Only customers can submit reviews
      if (currentUser?.role !== "customer") {
        return res.status(403).json({ message: "Only customers can submit reviews" });
      }

      // Verify invoice belongs to customer and has been sent
      const invoice = await storage.getInvoice(req.body.invoiceId);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      if (invoice.customerId !== userId) {
        return res.status(403).json({ message: "You can only review your own invoices" });
      }

      if (invoice.status === "draft") {
        return res.status(400).json({ message: "Can only review invoices that have been sent" });
      }

      // Check if review already exists
      const existingReview = await storage.getReviewByInvoice(req.body.invoiceId);
      if (existingReview) {
        return res.status(400).json({ message: "You have already reviewed this invoice" });
      }

      // Get mechanic info from associated job card if available
      let mechanicId = null;
      if (invoice.jobCardId) {
        const jobCard = await storage.getJobCard(invoice.jobCardId);
        mechanicId = jobCard?.mechanicId || null;
      }

      const validated = insertStaffReviewSchema.parse({
        ...req.body,
        customerId: userId,
        mechanicId: mechanicId,
        jobCardId: invoice.jobCardId || null,
      });

      const review = await storage.createStaffReview(validated);
      res.status(201).json(review);
    } catch (error) {
      console.error("Error creating review:", error);
      res.status(400).json({ message: "Failed to create review" });
    }
  });

  app.get("/api/reviews/invoice/:invoiceId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const currentUser = await storage.getUser(userId);
      const invoice = await storage.getInvoice(req.params.invoiceId);

      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      // Customer can only check their own invoices
      if (currentUser?.role === "customer" && invoice.customerId !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const review = await storage.getReviewByInvoice(req.params.invoiceId);
      res.json(review || null);
    } catch (error) {
      console.error("Error fetching review:", error);
      res.status(500).json({ message: "Failed to fetch review" });
    }
  });

  app.get("/api/reviews/job-card/:jobCardId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const currentUser = await storage.getUser(userId);
      const jobCard = await storage.getJobCard(req.params.jobCardId);

      if (!jobCard) {
        return res.status(404).json({ message: "Job card not found" });
      }

      // Customer can only check their own job cards
      if (currentUser?.role === "customer" && jobCard.customerId !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const review = await storage.getReviewByJobCard(req.params.jobCardId);
      res.json(review || null);
    } catch (error) {
      console.error("Error fetching review:", error);
      res.status(500).json({ message: "Failed to fetch review" });
    }
  });

  app.get("/api/reviews/my-reviews", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const reviews = await storage.getReviewsByCustomer(userId);
      res.json(reviews);
    } catch (error) {
      console.error("Error fetching customer reviews:", error);
      res.status(500).json({ message: "Failed to fetch reviews" });
    }
  });

  app.get("/api/reviews/staff/:staffId", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const reviews = await storage.getReviewsByStaff(req.params.staffId);
      res.json(reviews);
    } catch (error) {
      console.error("Error fetching staff reviews:", error);
      res.status(500).json({ message: "Failed to fetch staff reviews" });
    }
  });

  app.get("/api/reviews/stats/:staffId", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const stats = await storage.getStaffRatingStats(req.params.staffId);
      res.json(stats);
    } catch (error) {
      console.error("Error fetching staff rating stats:", error);
      res.status(500).json({ message: "Failed to fetch rating stats" });
    }
  });

  app.get("/api/reviews", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const reviews = await storage.getAllReviews();
      res.json({ 
        reviews, 
        totalCount: reviews.length 
      });
    } catch (error) {
      console.error("Error fetching all reviews:", error);
      res.status(500).json({ message: "Failed to fetch reviews" });
    }
  });

  // Review Response endpoint
  app.post("/api/reviews/:id/response", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const reviewId = req.params.id;
      const { responseText } = req.body;

      if (!responseText || responseText.trim() === "") {
        return res.status(400).json({ message: "Response text is required" });
      }

      // Get the review
      const review = await storage.getReviewById(reviewId);
      if (!review) {
        return res.status(404).json({ message: "Review not found" });
      }

      // Update the review with response
      const updatedReview = await storage.updateReview(reviewId, {
        responseText: responseText.trim(),
        respondedBy: userId,
        respondedAt: new Date(),
      });

      res.json(updatedReview);
    } catch (error) {
      console.error("Error adding review response:", error);
      res.status(500).json({ message: "Failed to add response" });
    }
  });

  // Review Moderation endpoints
  app.patch("/api/reviews/:id/moderate", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const reviewId = req.params.id;
      const { status, moderationNote } = req.body;

      // Validate status
      const validStatuses = ["published", "hidden", "flagged"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ message: "Invalid status. Must be one of: published, hidden, flagged" });
      }

      // Get the review
      const review = await storage.getReviewById(reviewId);
      if (!review) {
        return res.status(404).json({ message: "Review not found" });
      }

      // Update the review moderation status
      const updatedReview = await storage.updateReview(reviewId, {
        status,
        moderationNote: moderationNote || null,
        moderatedBy: userId,
        moderatedAt: new Date(),
      });

      res.json(updatedReview);
    } catch (error) {
      console.error("Error moderating review:", error);
      res.status(500).json({ message: "Failed to moderate review" });
    }
  });

  // Get review statistics and analytics
  app.get("/api/reviews/analytics", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const { startDate, endDate, staffId } = req.query;

      const filters: any = {};
      if (startDate) filters.startDate = new Date(startDate as string);
      if (endDate) filters.endDate = new Date(endDate as string);
      if (staffId) filters.staffId = staffId as string;

      const analytics = await storage.getReviewAnalytics(filters);
      res.json(analytics);
    } catch (error) {
      console.error("Error fetching review analytics:", error);
      res.status(500).json({ message: "Failed to fetch analytics" });
    }
  });

  // Export reviews
  app.get("/api/reviews/export", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const { format = "csv", startDate, endDate, staffId } = req.query;

      const filters: any = {};
      if (startDate) filters.startDate = new Date(startDate as string);
      if (endDate) filters.endDate = new Date(endDate as string);
      if (staffId) filters.staffId = staffId as string;

      const reviews = await storage.getReviewsForExport(filters);

      if (format === "csv") {
        const csv = storage.convertReviewsToCSV(reviews);
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="reviews-${Date.now()}.csv"`);
        res.send(csv);
      } else if (format === "json") {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Content-Disposition", `attachment; filename="reviews-${Date.now()}.json"`);
        res.json(reviews);
      } else {
        res.status(400).json({ message: "Invalid export format. Use csv or json" });
      }
    } catch (error) {
      console.error("Error exporting reviews:", error);
      res.status(500).json({ message: "Failed to export reviews" });
    }
  });

  // Send review reminder for specific invoice
  app.post("/api/reviews/send-reminder", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const { invoiceId } = req.body;

      if (!invoiceId) {
        return res.status(400).json({ message: "Invoice ID is required" });
      }

      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      // Check if review already exists
      const existingReview = await storage.getReviewByInvoice(invoiceId);
      if (existingReview) {
        return res.status(400).json({ message: "Invoice has already been reviewed" });
      }

      // Get customer details
      const customer = await storage.getUser(invoice.customerId);
      if (!customer?.email) {
        return res.status(400).json({ message: "Customer email not found" });
      }

      // Send reminder (integrate with your email service)
      // For now, we'll just return success
      res.json({
        success: true,
        message: `Review reminder will be sent to ${customer.email}`
      });
    } catch (error) {
      console.error("Error sending review reminder:", error);
      res.status(500).json({ message: "Failed to send reminder" });
    }
  });

  // Trigger review reminder job manually (admin only)
  app.post("/api/reviews/process-reminders", isAuthenticated, requireRole(["admin"]), async (req: any, res) => {
    try {
      const { runReviewReminderJob } = await import("./reviewReminders");
      await runReviewReminderJob();

      res.json({
        success: true,
        message: "Review reminder job completed successfully"
      });
    } catch (error) {
      console.error("Error running review reminder job:", error);
      res.status(500).json({ message: "Failed to process reminders" });
    }
  });

  // Update user avatar
  app.patch("/api/users/:id/avatar", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const targetUserId = req.params.id;
      const { profileImageUrl } = req.body;

      // Users can only update their own avatar unless they're admin
      const currentUser = await storage.getUser(userId);
      if (targetUserId !== userId && currentUser?.role !== 'admin') {
        return res.status(403).json({ message: "Not authorized to update other users' avatars" });
      }

      await storage.updateUser(targetUserId, {
        profileImageUrl
      });

      res.json({
        success: true,
        message: "Profile picture updated successfully"
      });
    } catch (error) {
      console.error("Error updating avatar:", error);
      res.status(500).json({ message: "Failed to update profile picture" });
    }
  });

  // Delete user avatar
  app.delete("/api/users/:id/avatar", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const targetUserId = req.params.id;

      // Users can only delete their own avatar unless they're admin
      const currentUser = await storage.getUser(userId);
      if (targetUserId !== userId && currentUser?.role !== 'admin') {
        return res.status(403).json({ message: "Not authorized to delete other users' avatars" });
      }

      await storage.updateUser(targetUserId, {
        profileImageUrl: null
      });

      res.json({
        success: true,
        message: "Profile picture removed successfully"
      });
    } catch (error) {
      console.error("Error deleting avatar:", error);
      res.status(500).json({ message: "Failed to remove profile picture" });
    }
  });

  // Update review request preferences
  app.patch("/api/users/:id/review-preferences", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const targetUserId = req.params.id;
      const { reviewRequestsEnabled } = req.body;

      // Users can only update their own preferences unless they're admin
      const currentUser = await storage.getUser(userId);
      if (targetUserId !== userId && currentUser?.role !== 'admin') {
        return res.status(403).json({ message: "Not authorized to update other users' preferences" });
      }

      await storage.updateUser(targetUserId, {
        reviewRequestsEnabled
      });

      res.json({
        success: true,
        message: "Review preferences updated successfully"
      });
    } catch (error) {
      console.error("Error updating review preferences:", error);
      res.status(500).json({ message: "Failed to update preferences" });
    }
  });

  // Update customer profile (for customers to update their own profile)
  app.patch("/api/users/:id/profile", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const targetUserId = req.params.id;

      // Users can only update their own profile unless they're admin/staff
      const currentUser = await storage.getUser(userId);
      if (targetUserId !== userId && !['admin', 'manager', 'receptionist'].includes(currentUser?.role || '')) {
        return res.status(403).json({ message: "Not authorized to update other users' profiles" });
      }

      // Only allow updating specific fields
      const allowedFields = ['firstName', 'lastName', 'phone', 'address', 'billingEmail', 'ccEmail'];
      const updates: any = {};
      
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
        }
      }

      // Validate email formats if provided
      if (updates.billingEmail && updates.billingEmail !== '') {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(updates.billingEmail)) {
          return res.status(400).json({ message: "Invalid billing email format" });
        }
      }

      if (updates.ccEmail && updates.ccEmail !== '') {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(updates.ccEmail)) {
          return res.status(400).json({ message: "Invalid CC email format" });
        }
      }

      const updatedUser = await storage.updateUser(targetUserId, updates);

      res.json({
        success: true,
        message: "Profile updated successfully",
        user: { ...updatedUser, password: undefined }
      });
    } catch (error) {
      console.error("Error updating profile:", error);
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  // Public reviews endpoint (no auth required for landing page)
  app.get("/api/reviews/public", async (req: any, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 9;

      // Get only published reviews with high ratings for public display
      const reviews = await storage.getPublicReviews(limit);

      res.json(reviews);
    } catch (error) {
      console.error("Error fetching public reviews:", error);
      res.status(500).json({ message: "Failed to fetch reviews" });
    }
  });

  // Expenses & Accounting Routes
  app.get("/api/expenses", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const expenses = await storage.getAllExpenses();
      res.json(expenses);
    } catch (error) {
      console.error("Error fetching expenses:", error);
      res.status(500).json({ message: "Failed to fetch expenses" });
    }
  });

  app.get("/api/expenses/:id", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const expense = await storage.getExpense(req.params.id);
      if (!expense) {
        return res.status(404).json({ message: "Expense not found" });
      }
      res.json(expense);
    } catch (error) {
      console.error("Error fetching expense:", error);
      res.status(500).json({ message: "Failed to fetch expense" });
    }
  });

  app.post("/api/expenses", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const validated = insertExpenseSchema.parse({ ...req.body, recordedBy: userId });
      const expense = await storage.createExpense(validated);
      res.status(201).json(expense);
    } catch (error) {
      console.error("Error creating expense:", error);
      res.status(400).json({ message: "Failed to create expense" });
    }
  });

  app.patch("/api/expenses/:id", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const validated = updateExpenseSchema.parse(req.body);
      const expense = await storage.updateExpense(req.params.id, validated);
      if (!expense) {
        return res.status(404).json({ message: "Expense not found" });
      }
      res.json(expense);
    } catch (error) {
      console.error("Error updating expense:", error);
      res.status(400).json({ message: "Failed to update expense" });
    }
  });

  app.delete("/api/expenses/:id", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      await storage.deleteExpense(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting expense:", error);
      res.status(500).json({ message: "Failed to delete expense" });
    }
  });

  app.get("/api/accounting/financial-summary", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : new Date(new Date().getFullYear(), 0, 1);
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : new Date();
      
      const summary = await storage.getFinancialSummary(startDate, endDate);
      res.json(summary);
    } catch (error) {
      console.error("Error fetching financial summary:", error);
      res.status(500).json({ message: "Failed to fetch financial summary" });
    }
  });

  app.get("/api/expenses/category/:category", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const expenses = await storage.getExpensesByCategory(req.params.category);
      res.json(expenses);
    } catch (error) {
      console.error("Error fetching expenses by category:", error);
      res.status(500).json({ message: "Failed to fetch expenses" });
    }
  });

  app.get("/api/expenses/service-type/:serviceType", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const expenses = await storage.getExpensesByServiceType(req.params.serviceType);
      res.json(expenses);
    } catch (error) {
      console.error("Error fetching expenses by service type:", error);
      res.status(500).json({ message: "Failed to fetch expenses" });
    }
  });

  // Stock Images Route - Serve images from attached_assets
  app.get("/stock-images/:filename", (req, res) => {
    const path = require("path");
    const fs = require("fs");
    const filePath = path.join(process.cwd(), "attached_assets", "stock_images", req.params.filename);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: "Image not found" });
    }

    // Set appropriate headers
    const ext = path.extname(req.params.filename).toLowerCase();
    const contentType = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
    }[ext] || 'application/octet-stream';

    res.set({
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
    });

    fs.createReadStream(filePath).pipe(res);
  });

  // Object Storage Routes - Reference: blueprint:javascript_object_storage
  
  app.get("/objects/:objectPath(*)", isAuthenticated, async (req: any, res) => {
    const userId = req.user?.claims?.sub;
    const objectStorageService = new ObjectStorageService();
    const storageType = process.env.STORAGE_TYPE || 'replit-gcs';
    
    try {
      // Check if object exists
      const exists = await objectStorageService.checkObjectEntityExists(req.path);
      if (!exists) {
        return res.sendStatus(404);
      }

      // For Replit GCS, check ACL permissions
      if (storageType === 'replit-gcs') {
        const objectFile = await objectStorageService.getObjectEntityFile(req.path);
        const canAccess = await objectStorageService.canAccessObjectEntity({
          objectFile,
          userId: userId,
          requestedPermission: ObjectPermission.READ,
        });
        if (!canAccess) {
          return res.sendStatus(401);
        }
      }
      // For non-GCS storage, ACL is not enforced (implement custom logic if needed)

      // Download using universal method
      await objectStorageService.downloadObjectByPath(req.path, res);
    } catch (error) {
      console.error("Error checking object access:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.sendStatus(404);
      }
      return res.sendStatus(500);
    }
  });

  app.post("/api/objects/upload", isAuthenticated, async (req: any, res) => {
    const objectStorageService = new ObjectStorageService();
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    res.json({ uploadURL });
  });

  app.post("/api/objects/public-upload", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    const filename = req.body.filename || 'file';
    const objectStorageService = new ObjectStorageService();
    const { uploadURL, publicUrl } = await objectStorageService.getPublicUploadURL(filename);
    res.json({ uploadURL, publicUrl });
  });

  app.post("/api/inspection-photos", isAuthenticated, async (req: any, res) => {
    if (!req.body.photoURL || !req.body.vehicleId) {
      return res.status(400).json({ error: "photoURL and vehicleId are required" });
    }

    const userId = req.user?.claims?.sub;
    try {
      const objectStorageService = new ObjectStorageService();
      const objectPath = await objectStorageService.trySetObjectEntityAclPolicy(
        req.body.photoURL,
        {
          owner: userId,
          visibility: "private",
          aclRules: [
            {
              group: {
                type: ObjectAccessGroupType.VEHICLE_OWNER,
                id: req.body.vehicleId,
              },
              permission: ObjectPermission.READ,
            },
            {
              group: {
                type: ObjectAccessGroupType.STAFF_ROLE,
                id: "staff",
              },
              permission: ObjectPermission.READ,
            },
          ],
        },
      );

      res.status(200).json({ objectPath });
    } catch (error) {
      console.error("Error setting inspection photo ACL:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/vehicle-photos", isAuthenticated, async (req: any, res) => {
    if (!req.body.photoURL || !req.body.vehicleId) {
      return res.status(400).json({ error: "photoURL and vehicleId are required" });
    }

    const userId = getAuthenticatedUserId(req);
    try {
      // Verify vehicle exists
      const vehicle = await storage.getVehicle(req.body.vehicleId);
      if (!vehicle) {
        return res.status(404).json({ error: "Vehicle not found" });
      }

      // Verify ownership: customers can only add photos to their own vehicles
      const currentUser = await storage.getUser(userId);
      const isStaff = currentUser?.role && ["admin", "manager", "mechanic", "receptionist"].includes(currentUser.role);
      
      if (!isStaff && vehicle.customerId !== userId) {
        return res.status(403).json({ error: "Forbidden: Cannot add photos to another customer's vehicle" });
      }

      const objectStorageService = new ObjectStorageService();
      const objectPath = await objectStorageService.trySetObjectEntityAclPolicy(
        req.body.photoURL,
        {
          owner: userId,
          visibility: "private",
          aclRules: [
            {
              group: {
                type: ObjectAccessGroupType.VEHICLE_OWNER,
                id: req.body.vehicleId,
              },
              permission: ObjectPermission.READ,
            },
            {
              group: {
                type: ObjectAccessGroupType.STAFF_ROLE,
                id: "staff",
              },
              permission: ObjectPermission.READ,
            },
          ],
        },
      );

      // Add photo to vehicle
      const currentPhotos = vehicle.photos || [];
      await storage.updateVehicle(req.body.vehicleId, {
        photos: [...currentPhotos, objectPath],
      });

      res.status(200).json({ objectPath });
    } catch (error) {
      console.error("Error setting vehicle photo ACL:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Delete vehicle photo
  app.delete("/api/vehicle-photos", isAuthenticated, async (req: any, res) => {
    if (!req.body.photoUrl || !req.body.vehicleId) {
      return res.status(400).json({ error: "photoUrl and vehicleId are required" });
    }

    const userId = getAuthenticatedUserId(req);
    try {
      // Verify vehicle exists
      const vehicle = await storage.getVehicle(req.body.vehicleId);
      if (!vehicle) {
        return res.status(404).json({ error: "Vehicle not found" });
      }

      // Verify ownership: customers can only remove photos from their own vehicles
      const currentUser = await storage.getUser(userId);
      const isStaff = currentUser?.role && ["admin", "manager", "mechanic", "receptionist"].includes(currentUser.role);
      
      if (!isStaff && vehicle.customerId !== userId) {
        return res.status(403).json({ error: "Forbidden: Cannot remove photos from another customer's vehicle" });
      }

      // Remove photo from vehicle's photos array
      const currentPhotos = vehicle.photos || [];
      const updatedPhotos = currentPhotos.filter(photo => photo !== req.body.photoUrl);
      
      await storage.updateVehicle(req.body.vehicleId, {
        photos: updatedPhotos,
      });

      res.status(200).json({ success: true, photos: updatedPhotos });
    } catch (error) {
      console.error("Error deleting vehicle photo:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Set primary vehicle photo (reorder photos with the specified one first)
  app.post("/api/vehicle-photos/set-primary", isAuthenticated, async (req: any, res) => {
    if (req.body.photoIndex === undefined || !req.body.vehicleId) {
      return res.status(400).json({ error: "photoIndex and vehicleId are required" });
    }

    const userId = getAuthenticatedUserId(req);
    try {
      // Verify vehicle exists
      const vehicle = await storage.getVehicle(req.body.vehicleId);
      if (!vehicle) {
        return res.status(404).json({ error: "Vehicle not found" });
      }

      // Verify ownership: customers can only reorder photos on their own vehicles
      const currentUser = await storage.getUser(userId);
      const isStaff = currentUser?.role && ["admin", "manager", "mechanic", "receptionist"].includes(currentUser.role);
      
      if (!isStaff && vehicle.customerId !== userId) {
        return res.status(403).json({ error: "Forbidden: Cannot reorder photos on another customer's vehicle" });
      }

      // Reorder photos with the selected one as primary (first)
      const currentPhotos = vehicle.photos || [];
      if (req.body.photoIndex >= 0 && req.body.photoIndex < currentPhotos.length) {
        const updatedPhotos = [...currentPhotos];
        const [primaryPhoto] = updatedPhotos.splice(req.body.photoIndex, 1);
        updatedPhotos.unshift(primaryPhoto);
        
        await storage.updateVehicle(req.body.vehicleId, {
          photos: updatedPhotos,
        });

        res.status(200).json({ success: true, photos: updatedPhotos });
      } else {
        res.status(400).json({ error: "Invalid photo index" });
      }
    } catch (error) {
      console.error("Error setting primary vehicle photo:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/job-card-photos", isAuthenticated, async (req: any, res) => {
    if (!req.body.photoURL || !req.body.vehicleId) {
      return res.status(400).json({ error: "photoURL and vehicleId are required" });
    }

    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const objectStorageService = new ObjectStorageService();
      const objectPath = await objectStorageService.trySetObjectEntityAclPolicy(
        req.body.photoURL,
        {
          owner: userId,
          visibility: "private",
          aclRules: [
            {
              group: {
                type: ObjectAccessGroupType.VEHICLE_OWNER,
                id: req.body.vehicleId,
              },
              permission: ObjectPermission.READ,
            },
            {
              group: {
                type: ObjectAccessGroupType.STAFF_ROLE,
                id: "staff",
              },
              permission: ObjectPermission.READ,
            },
          ],
        },
      );

      res.status(200).json({ objectPath });
    } catch (error) {
      console.error("Error setting job card photo ACL:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.patch("/api/job-cards/:id/photos", isAuthenticated, async (req: any, res) => {
    const userId = getUserId(req);
    const jobCardId = req.params.id;
    const { photoPath } = req.body;

    if (!photoPath) {
      return res.status(400).json({ error: "photoPath is required" });
    }

    try {
      const jobCard = await storage.getJobCard(jobCardId);
      if (!jobCard) {
        return res.status(404).json({ error: "Job card not found" });
      }

      const currentPhotos = jobCard.photos || [];
      const updatedPhotos = [...currentPhotos, photoPath];

      await db.update(jobCards)
        .set({ photos: updatedPhotos })
        .where(eq(jobCards.id, jobCardId));

      res.json({ success: true, photos: updatedPhotos });
    } catch (error) {
      console.error("Error adding photo to job card:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ========================================
  // RENTAL VEHICLE ROUTES
  // ========================================

  // Get all rental vehicles
  app.get("/api/rental-vehicles", isAuthenticated, async (req: any, res) => {
    try {
      const vehicles = await storage.getAllRentalVehicles();
      res.json(vehicles);
    } catch (error) {
      console.error("Error fetching rental vehicles:", error);
      res.status(500).json({ message: "Failed to fetch rental vehicles" });
    }
  });

  // Get available rental vehicles (with optional date filtering)
  app.get("/api/rental-vehicles/available", isAuthenticated, async (req: any, res) => {
    try {
      const { startDate, endDate } = req.query;
      const start = startDate ? new Date(startDate as string) : undefined;
      const end = endDate ? new Date(endDate as string) : undefined;

      const vehicles = await storage.getAvailableRentalVehicles(start, end);
      res.json(vehicles);
    } catch (error) {
      console.error("Error fetching available rental vehicles:", error);
      res.status(500).json({ message: "Failed to fetch available rental vehicles" });
    }
  });

  // Get single rental vehicle
  app.get("/api/rental-vehicles/:id", isAuthenticated, async (req: any, res) => {
    try {
      const vehicle = await storage.getRentalVehicle(req.params.id);
      if (!vehicle) {
        return res.status(404).json({ message: "Rental vehicle not found" });
      }
      res.json(vehicle);
    } catch (error) {
      console.error("Error fetching rental vehicle:", error);
      res.status(500).json({ message: "Failed to fetch rental vehicle" });
    }
  });

  // Create rental vehicle (staff only)
  app.post("/api/rental-vehicles", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const validated = insertRentalVehicleSchema.parse(req.body);
      const vehicle = await storage.createRentalVehicle(validated);
      res.status(201).json(vehicle);
    } catch (error: any) {
      console.error("Error creating rental vehicle:", error);
      res.status(400).json({ message: error.message || "Failed to create rental vehicle" });
    }
  });

  // Update rental vehicle (staff only)
  app.patch("/api/rental-vehicles/:id", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const validated = updateRentalVehicleSchema.parse(req.body);
      const vehicle = await storage.updateRentalVehicle(req.params.id, validated);
      if (!vehicle) {
        return res.status(404).json({ message: "Rental vehicle not found" });
      }
      res.json(vehicle);
    } catch (error: any) {
      console.error("Error updating rental vehicle:", error);
      res.status(400).json({ message: error.message || "Failed to update rental vehicle" });
    }
  });

  // Delete rental vehicle (admin only)
  app.delete("/api/rental-vehicles/:id", isAuthenticated, requireRole(["admin"]), async (req: any, res) => {
    try {
      await storage.deleteRentalVehicle(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting rental vehicle:", error);
      res.status(500).json({ message: "Failed to delete rental vehicle" });
    }
  });

  // ========================================
  // RENTAL EXTRAS ROUTES
  // ========================================

  // Get all rental extras
  app.get("/api/rental-extras", isAuthenticated, async (req: any, res) => {
    try {
      const extras = await storage.getAllRentalExtras();
      res.json(extras);
    } catch (error) {
      console.error("Error fetching rental extras:", error);
      res.status(500).json({ message: "Failed to fetch rental extras" });
    }
  });

  // Get active rental extras (for customer booking)
  app.get("/api/rental-extras/active", isAuthenticated, async (req: any, res) => {
    try {
      const extras = await storage.getActiveRentalExtras();
      res.json(extras);
    } catch (error) {
      console.error("Error fetching active rental extras:", error);
      res.status(500).json({ message: "Failed to fetch active rental extras" });
    }
  });

  // Create rental extra (staff only)
  app.post("/api/rental-extras", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const validated = insertRentalExtraSchema.parse(req.body);
      const extra = await storage.createRentalExtra(validated);
      res.status(201).json(extra);
    } catch (error: any) {
      console.error("Error creating rental extra:", error);
      res.status(400).json({ message: error.message || "Failed to create rental extra" });
    }
  });

  // Update rental extra (staff only)
  app.patch("/api/rental-extras/:id", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const validated = updateRentalExtraSchema.parse(req.body);
      const extra = await storage.updateRentalExtra(req.params.id, validated);
      if (!extra) {
        return res.status(404).json({ message: "Rental extra not found" });
      }
      res.json(extra);
    } catch (error: any) {
      console.error("Error updating rental extra:", error);
      res.status(400).json({ message: error.message || "Failed to update rental extra" });
    }
  });

  // Delete rental extra (admin only)
  app.delete("/api/rental-extras/:id", isAuthenticated, requireRole(["admin"]), async (req: any, res) => {
    try {
      await storage.deleteRentalExtra(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting rental extra:", error);
      res.status(500).json({ message: "Failed to delete rental extra" });
    }
  });

  // ========================================
  // RENTAL RESERVATIONS ROUTES
  // ========================================

  // Get all rental reservations (staff) or customer's own reservations
  app.get("/api/rental-reservations", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const user = await storage.getUser(userId);

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      let reservations;
      if (["admin", "manager", "receptionist"].includes(user.role)) {
        // Staff can see all reservations
        reservations = await storage.getAllRentalReservations();
      } else {
        // Customers see only their own
        reservations = await storage.getRentalReservationsByCustomer(userId);
      }

      res.json(reservations);
    } catch (error) {
      console.error("Error fetching rental reservations:", error);
      res.status(500).json({ message: "Failed to fetch rental reservations" });
    }
  });

  // Get single rental reservation
  app.get("/api/rental-reservations/:id", isAuthenticated, requireOwnershipOrRole(["admin", "manager", "receptionist"]), async (req: any, res) => {
    try {
      const reservation = await storage.getRentalReservation(req.params.id);
      if (!reservation) {
        return res.status(404).json({ message: "Rental reservation not found" });
      }
      res.json(reservation);
    } catch (error) {
      console.error("Error fetching rental reservation:", error);
      res.status(500).json({ message: "Failed to fetch rental reservation" });
    }
  });

  // Get reservations by vehicle (staff only)
  app.get("/api/rental-vehicles/:vehicleId/reservations", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req: any, res) => {
    try {
      const reservations = await storage.getRentalReservationsByVehicle(req.params.vehicleId);
      res.json(reservations);
    } catch (error) {
      console.error("Error fetching vehicle reservations:", error);
      res.status(500).json({ message: "Failed to fetch vehicle reservations" });
    }
  });

  // Create rental reservation
  app.post("/api/rental-reservations", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);

      // Generate reservation number
      const reservationNumber = await storage.generateRentalReservationNumber();

      const data = {
        ...req.body,
        customerId: req.body.customerId || userId, // Allow staff to create for any customer
        reservationNumber,
        pickupDate: new Date(req.body.pickupDate),
        returnDate: new Date(req.body.returnDate),
        actualReturnDate: req.body.actualReturnDate ? new Date(req.body.actualReturnDate) : undefined,
      };

      const validated = insertRentalReservationSchema.parse(data);
      const reservation = await storage.createRentalReservation(validated);
      res.status(201).json(reservation);
    } catch (error: any) {
      console.error("Error creating rental reservation:", error);
      res.status(400).json({ message: error.message || "Failed to create rental reservation" });
    }
  });

  // Update rental reservation
  app.patch("/api/rental-reservations/:id", isAuthenticated, async (req: any, res) => {
    try {
      const data = {
        ...req.body,
        pickupDate: req.body.pickupDate ? new Date(req.body.pickupDate) : undefined,
        returnDate: req.body.returnDate ? new Date(req.body.returnDate) : undefined,
        actualReturnDate: req.body.actualReturnDate ? new Date(req.body.actualReturnDate) : undefined,
      };

      const validated = updateRentalReservationSchema.parse(data);
      const reservation = await storage.updateRentalReservation(req.params.id, validated);
      if (!reservation) {
        return res.status(404).json({ message: "Rental reservation not found" });
      }
      res.json(reservation);
    } catch (error: any) {
      console.error("Error updating rental reservation:", error);
      res.status(400).json({ message: error.message || "Failed to update rental reservation" });
    }
  });

  // Delete rental reservation (staff only)
  app.delete("/api/rental-reservations/:id", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      await storage.deleteRentalReservation(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting rental reservation:", error);
      res.status(500).json({ message: "Failed to delete rental reservation" });
    }
  });

  // ========================================
  // RENTAL PAYMENTS ROUTES
  // ========================================

  // Get payments for a reservation
  app.get("/api/rental-reservations/:reservationId/payments", isAuthenticated, async (req: any, res) => {
    try {
      const payments = await storage.getRentalPaymentsByReservation(req.params.reservationId);
      res.json(payments);
    } catch (error) {
      console.error("Error fetching rental payments:", error);
      res.status(500).json({ message: "Failed to fetch rental payments" });
    }
  });

  // Create rental payment
  app.post("/api/rental-payments", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req: any, res) => {
    try {
      const validated = insertRentalPaymentSchema.parse(req.body);
      const payment = await storage.createRentalPayment(validated);
      res.status(201).json(payment);
    } catch (error: any) {
      console.error("Error creating rental payment:", error);
      res.status(400).json({ message: error.message || "Failed to create rental payment" });
    }
  });

  // ========================================
  // RENTAL CONTRACTS ROUTES
  // ========================================

  // Get all rental contracts (staff only)
  app.get("/api/rental-contracts", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req: any, res) => {
    try {
      const contracts = await storage.getAllRentalContracts();
      res.json(contracts);
    } catch (error) {
      console.error("Error fetching rental contracts:", error);
      res.status(500).json({ message: "Failed to fetch rental contracts" });
    }
  });

  // Get contract by reservation
  app.get("/api/rental-reservations/:reservationId/contract", isAuthenticated, async (req: any, res) => {
    try {
      const contract = await storage.getRentalContractByReservation(req.params.reservationId);
      if (!contract) {
        return res.status(404).json({ message: "Rental contract not found" });
      }
      res.json(contract);
    } catch (error) {
      console.error("Error fetching rental contract:", error);
      res.status(500).json({ message: "Failed to fetch rental contract" });
    }
  });

  // Create rental contract (staff only)
  app.post("/api/rental-contracts", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req: any, res) => {
    try {
      const contractNumber = await storage.generateRentalContractNumber();

      const data = {
        ...req.body,
        contractNumber,
        licenseExpiry: new Date(req.body.licenseExpiry),
        checkoutAt: req.body.checkoutAt ? new Date(req.body.checkoutAt) : undefined,
        checkinAt: req.body.checkinAt ? new Date(req.body.checkinAt) : undefined,
        agreedAt: req.body.agreedAt ? new Date(req.body.agreedAt) : undefined,
      };

      const validated = insertRentalContractSchema.parse(data);
      const contract = await storage.createRentalContract(validated);
      res.status(201).json(contract);
    } catch (error: any) {
      console.error("Error creating rental contract:", error);
      res.status(400).json({ message: error.message || "Failed to create rental contract" });
    }
  });

  // Update rental contract (staff only)
  app.patch("/api/rental-contracts/:id", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req: any, res) => {
    try {
      const data = {
        ...req.body,
        checkoutAt: req.body.checkoutAt ? new Date(req.body.checkoutAt) : undefined,
        checkinAt: req.body.checkinAt ? new Date(req.body.checkinAt) : undefined,
        agreedAt: req.body.agreedAt ? new Date(req.body.agreedAt) : undefined,
      };

      const validated = updateRentalContractSchema.parse(data);
      const contract = await storage.updateRentalContract(req.params.id, validated);
      if (!contract) {
        return res.status(404).json({ message: "Rental contract not found" });
      }
      res.json(contract);
    } catch (error: any) {
      console.error("Error updating rental contract:", error);
      res.status(400).json({ message: error.message || "Failed to update rental contract" });
    }
  });

  // ========================================
  // RENTAL MAINTENANCE ROUTES
  // ========================================

  // Get maintenance logs for a vehicle (staff only)
  app.get("/api/rental-vehicles/:vehicleId/maintenance", isAuthenticated, requireRole(["admin", "manager", "mechanic"]), async (req: any, res) => {
    try {
      const logs = await storage.getRentalMaintenanceByVehicle(req.params.vehicleId);
      res.json(logs);
    } catch (error) {
      console.error("Error fetching rental maintenance logs:", error);
      res.status(500).json({ message: "Failed to fetch rental maintenance logs" });
    }
  });

  // Create maintenance log (staff only)
  app.post("/api/rental-maintenance", isAuthenticated, requireRole(["admin", "manager", "mechanic"]), async (req: any, res) => {
    try {
      const data = {
        ...req.body,
        scheduledDate: req.body.scheduledDate ? new Date(req.body.scheduledDate) : undefined,
        completedDate: req.body.completedDate ? new Date(req.body.completedDate) : undefined,
        nextServiceDate: req.body.nextServiceDate ? new Date(req.body.nextServiceDate) : undefined,
      };

      const validated = insertRentalMaintenanceSchema.parse(data);
      const log = await storage.createRentalMaintenance(validated);
      res.status(201).json(log);
    } catch (error: any) {
      console.error("Error creating rental maintenance log:", error);
      res.status(400).json({ message: error.message || "Failed to create rental maintenance log" });
    }
  });

  // Update maintenance log (staff only)
  app.patch("/api/rental-maintenance/:id", isAuthenticated, requireRole(["admin", "manager", "mechanic"]), async (req: any, res) => {
    try {
      const data = {
        ...req.body,
        scheduledDate: req.body.scheduledDate ? new Date(req.body.scheduledDate) : undefined,
        completedDate: req.body.completedDate ? new Date(req.body.completedDate) : undefined,
        nextServiceDate: req.body.nextServiceDate ? new Date(req.body.nextServiceDate) : undefined,
      };

      const validated = updateRentalMaintenanceSchema.parse(data);
      const log = await storage.updateRentalMaintenance(req.params.id, validated);
      if (!log) {
        return res.status(404).json({ message: "Rental maintenance log not found" });
      }
      res.json(log);
    } catch (error: any) {
      console.error("Error updating rental maintenance log:", error);
      res.status(400).json({ message: error.message || "Failed to update rental maintenance log" });
    }
  });

  // ========================================
  // TOWING SERVICE ROUTES
  // ========================================

  // TOW TRUCKS ROUTES
  app.get("/api/tow-trucks", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req: any, res) => {
    try {
      const trucks = await storage.getAllTowTrucks();
      res.json(trucks);
    } catch (error) {
      console.error("Error fetching tow trucks:", error);
      res.status(500).json({ message: "Failed to fetch tow trucks" });
    }
  });

  app.get("/api/tow-trucks/available", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req: any, res) => {
    try {
      const trucks = await storage.getAvailableTowTrucks();
      res.json(trucks);
    } catch (error) {
      console.error("Error fetching available tow trucks:", error);
      res.status(500).json({ message: "Failed to fetch available tow trucks" });
    }
  });

  app.post("/api/tow-trucks", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const validated = insertTowTruckSchema.parse(req.body);
      const truck = await storage.createTowTruck(validated);
      res.status(201).json(truck);
    } catch (error: any) {
      console.error("Error creating tow truck:", error);
      res.status(400).json({ message: error.message || "Failed to create tow truck" });
    }
  });

  app.patch("/api/tow-trucks/:id", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const validated = updateTowTruckSchema.parse(req.body);
      const truck = await storage.updateTowTruck(req.params.id, validated);
      if (!truck) {
        return res.status(404).json({ message: "Tow truck not found" });
      }
      res.json(truck);
    } catch (error: any) {
      console.error("Error updating tow truck:", error);
      res.status(400).json({ message: error.message || "Failed to update tow truck" });
    }
  });

  app.delete("/api/tow-trucks/:id", isAuthenticated, requireRole(["admin"]), async (req: any, res) => {
    try {
      await storage.deleteTowTruck(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting tow truck:", error);
      res.status(500).json({ message: "Failed to delete tow truck" });
    }
  });

  // WRECKER DRIVERS ROUTES
  app.get("/api/wrecker-drivers", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req: any, res) => {
    try {
      const drivers = await storage.getAllWreckerDrivers();
      res.json(drivers);
    } catch (error) {
      console.error("Error fetching wrecker drivers:", error);
      res.status(500).json({ message: "Failed to fetch wrecker drivers" });
    }
  });

  app.get("/api/wrecker-drivers/available", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req: any, res) => {
    try {
      const drivers = await storage.getAvailableWreckerDrivers();
      res.json(drivers);
    } catch (error) {
      console.error("Error fetching available drivers:", error);
      res.status(500).json({ message: "Failed to fetch available drivers" });
    }
  });

  app.post("/api/wrecker-drivers", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const data = {
        ...req.body,
        licenseExpiry: new Date(req.body.licenseExpiry),
        hireDate: new Date(req.body.hireDate),
      };
      const validated = insertWreckerDriverSchema.parse(data);
      const driver = await storage.createWreckerDriver(validated);
      res.status(201).json(driver);
    } catch (error: any) {
      console.error("Error creating wrecker driver:", error);
      res.status(400).json({ message: error.message || "Failed to create wrecker driver" });
    }
  });

  app.patch("/api/wrecker-drivers/:id", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const data = {
        ...req.body,
        licenseExpiry: req.body.licenseExpiry ? new Date(req.body.licenseExpiry) : undefined,
        hireDate: req.body.hireDate ? new Date(req.body.hireDate) : undefined,
      };
      const validated = updateWreckerDriverSchema.parse(data);
      const driver = await storage.updateWreckerDriver(req.params.id, validated);
      if (!driver) {
        return res.status(404).json({ message: "Wrecker driver not found" });
      }
      res.json(driver);
    } catch (error: any) {
      console.error("Error updating wrecker driver:", error);
      res.status(400).json({ message: error.message || "Failed to update wrecker driver" });
    }
  });

  // THIRD PARTY WRECKERS ROUTES
  app.get("/api/third-party-wreckers", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req: any, res) => {
    try {
      const wreckers = await storage.getAllThirdPartyWreckers();
      res.json(wreckers);
    } catch (error) {
      console.error("Error fetching third party wreckers:", error);
      res.status(500).json({ message: "Failed to fetch third party wreckers" });
    }
  });

  app.post("/api/third-party-wreckers", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const validated = insertThirdPartyWreckerSchema.parse(req.body);
      const wrecker = await storage.createThirdPartyWrecker(validated);
      res.status(201).json(wrecker);
    } catch (error: any) {
      console.error("Error creating third party wrecker:", error);
      res.status(400).json({ message: error.message || "Failed to create third party wrecker" });
    }
  });

  // TOW PRICING ZONES ROUTES
  app.get("/api/tow-pricing-zones", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const zones = await storage.getAllTowPricingZones();
      res.json(zones);
    } catch (error) {
      console.error("Error fetching tow pricing zones:", error);
      res.status(500).json({ message: "Failed to fetch tow pricing zones" });
    }
  });

  app.post("/api/tow-pricing-zones", isAuthenticated, requireRole(["admin", "manager"]), async (req: any, res) => {
    try {
      const validated = insertTowPricingZoneSchema.parse(req.body);
      const zone = await storage.createTowPricingZone(validated);
      res.status(201).json(zone);
    } catch (error: any) {
      console.error("Error creating tow pricing zone:", error);
      res.status(400).json({ message: error.message || "Failed to create tow pricing zone" });
    }
  });

  // TOW REQUESTS ROUTES
  app.get("/api/tow-requests", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const user = await storage.getUser(userId);

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      let requests;
      if (["admin", "manager", "receptionist"].includes(user.role)) {
        // Staff can see all requests
        requests = await storage.getAllTowRequests();
      } else {
        // Customers see only their own
        requests = await storage.getTowRequestsByCustomer(userId);
      }

      res.json(requests);
    } catch (error) {
      console.error("Error fetching tow requests:", error);
      res.status(500).json({ message: "Failed to fetch tow requests" });
    }
  });

  app.get("/api/tow-requests/active", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req: any, res) => {
    try {
      const requests = await storage.getActiveTowRequests();
      res.json(requests);
    } catch (error) {
      console.error("Error fetching active tow requests:", error);
      res.status(500).json({ message: "Failed to fetch active tow requests" });
    }
  });

  app.get("/api/tow-requests/:id", isAuthenticated, async (req: any, res) => {
    try {
      const request = await storage.getTowRequest(req.params.id);
      if (!request) {
        return res.status(404).json({ message: "Tow request not found" });
      }
      res.json(request);
    } catch (error) {
      console.error("Error fetching tow request:", error);
      res.status(500).json({ message: "Failed to fetch tow request" });
    }
  });

  app.post("/api/tow-requests", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const requestNumber = await storage.generateTowRequestNumber();

      const data = {
        ...req.body,
        customerId: req.body.customerId || userId,
        requestNumber,
        requestedAt: new Date(),
      };

      const validated = insertTowRequestSchema.parse(data);
      const request = await storage.createTowRequest(validated);
      res.status(201).json(request);
    } catch (error: any) {
      console.error("Error creating tow request:", error);
      res.status(400).json({ message: error.message || "Failed to create tow request" });
    }
  });

  app.patch("/api/tow-requests/:id", isAuthenticated, async (req: any, res) => {
    try {
      // Get original request to check status change
      const originalRequest = await storage.getTowRequest(req.params.id);
      
      const data = {
        ...req.body,
        dispatchedAt: req.body.dispatchedAt ? new Date(req.body.dispatchedAt) : undefined,
        arrivedAt: req.body.arrivedAt ? new Date(req.body.arrivedAt) : undefined,
        completedAt: req.body.completedAt ? new Date(req.body.completedAt) : undefined,
        estimatedArrival: req.body.estimatedArrival ? new Date(req.body.estimatedArrival) : undefined,
      };

      const validated = updateTowRequestSchema.parse(data);
      const request = await storage.updateTowRequest(req.params.id, validated);
      if (!request) {
        return res.status(404).json({ message: "Tow request not found" });
      }
      
      // Send push notification on status change
      if (validated.status && originalRequest && validated.status !== originalRequest.status) {
        const customer = await storage.getUser(request.customerId);
        if (customer) {
          if (validated.status === 'en_route') {
            const notification = pushNotificationService.createTowRequestNotification('en_route', {});
            pushNotificationService.sendToUser(customer, notification).catch(err => {
              console.error('Failed to send tow en_route notification:', err);
            });
          }
        }
      }
      
      res.json(request);
    } catch (error: any) {
      console.error("Error updating tow request:", error);
      res.status(400).json({ message: error.message || "Failed to update tow request" });
    }
  });

  // Assign driver to tow request
  app.post("/api/tow-requests/:id/assign", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req: any, res) => {
    try {
      const { assignedDriverId, assignedTruckId, wreckerType } = req.body;

      const request = await storage.updateTowRequest(req.params.id, {
        assignedDriverId,
        assignedTruckId,
        wreckerType: wreckerType || "company_owned",
        status: "dispatched",
        dispatchedAt: new Date(),
      });

      if (!request) {
        return res.status(404).json({ message: "Tow request not found" });
      }

      // Send push notification to customer
      const customer = await storage.getUser(request.customerId);
      if (customer && assignedDriverId) {
        const driver = await storage.getWreckerDriver(assignedDriverId);
        const driverUser = driver ? await storage.getUser(driver.userId) : null;
        const driverName = driverUser
          ? `${driverUser.firstName || ''} ${driverUser.lastName || ''}`.trim() || driverUser.phone || undefined
          : undefined;
        const notification = pushNotificationService.createTowRequestNotification(
          'assigned',
          {
            driverName,
          }
        );
        pushNotificationService.sendToUser(customer, notification).catch(err => {
          console.error('Failed to send tow assignment notification:', err);
        });
      }

      res.json(request);
    } catch (error: any) {
      console.error("Error assigning driver to tow request:", error);
      res.status(400).json({ message: error.message || "Failed to assign driver" });
    }
  });

  // Complete tow and optionally create job card
  app.post("/api/tow-requests/:id/complete", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req: any, res) => {
    try {
      const { createJobCard, actualDistance, totalPrice } = req.body;
      const request = await storage.getTowRequest(req.params.id);

      if (!request) {
        return res.status(404).json({ message: "Tow request not found" });
      }

      let jobCardId = null;

      // Create job card if requested and vehicle brought to shop
      if (createJobCard && request.vehicleId) {
        const jobCard = await storage.createJobCard({
          customerId: request.customerId,
          vehicleId: request.vehicleId,
          description: `Vehicle towed from ${request.pickupLocation}. ${request.problemDescription || ''}`,
          scheduledDate: new Date(),
          status: "scheduled",
          laborHours: "0",
          laborRate: "0",
          totalCost: "0",
        });
        jobCardId = jobCard.id;
      }

      const updatedRequest = await storage.updateTowRequest(req.params.id, {
        status: "completed",
        completedAt: new Date(),
        actualDistance,
        totalPrice,
        jobCardId,
      });
      if (!updatedRequest) {
        return res.status(404).json({ message: "Tow request not found" });
      }

      // Send push notification to customer
      const customer = await storage.getUser(updatedRequest.customerId);
      if (customer) {
        const notification = pushNotificationService.createTowRequestNotification(
          'completed',
          {}
        );
        pushNotificationService.sendToUser(customer, notification).catch(err => {
          console.error('Failed to send tow completion notification:', err);
        });
      }

      res.json(updatedRequest);
    } catch (error: any) {
      console.error("Error completing tow request:", error);
      res.status(400).json({ message: error.message || "Failed to complete tow request" });
    }
  });

  // GPS TRACKING ROUTES
  app.get("/api/tow-requests/:id/tracking", isAuthenticated, async (req: any, res) => {
    try {
      const locations = await storage.getTowRequestLocations(req.params.id);
      res.json(locations);
    } catch (error) {
      console.error("Error fetching tow request locations:", error);
      res.status(500).json({ message: "Failed to fetch tow request locations" });
    }
  });

  app.get("/api/tow-requests/:id/tracking/latest", isAuthenticated, async (req: any, res) => {
    try {
      const location = await storage.getLatestTowRequestLocation(req.params.id);
      res.json(location || null);
    } catch (error) {
      console.error("Error fetching latest location:", error);
      res.status(500).json({ message: "Failed to fetch latest location" });
    }
  });

  app.post("/api/tow-requests/:id/tracking", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const driver = await storage.getWreckerDriverByUserId(userId);

      if (!driver) {
        return res.status(403).json({ message: "Not authorized as a driver" });
      }

      const validated = insertTowRequestLocationSchema.parse({
        ...req.body,
        towRequestId: req.params.id,
        driverId: driver.id,
      });

      const location = await storage.createTowRequestLocation(validated);

      // Also update driver's current location
      await storage.updateWreckerDriver(driver.id, {
        currentLocation: `${req.body.latitude},${req.body.longitude}`,
      });

      res.status(201).json(location);
    } catch (error: any) {
      console.error("Error creating location update:", error);
      res.status(400).json({ message: error.message || "Failed to create location update" });
    }
  });

  // Chat API endpoints
  app.get("/api/chat/conversations", isAuthenticated, requireRole(["admin", "manager", "mechanic", "receptionist"]), async (req, res) => {
    try {
      const conversations = await storage.getActiveChatConversations();
      res.json(conversations);
    } catch (error: any) {
      console.error("Error fetching conversations:", error);
      res.status(500).json({ message: "Failed to fetch conversations" });
    }
  });

  app.get("/api/chat/conversations/:id", isAuthenticated, async (req, res) => {
    try {
      const conversation = await storage.getChatConversation(req.params.id);
      if (!conversation) {
        return res.status(404).json({ message: "Conversation not found" });
      }

      // Check access - staff can see all, customers only their own
      const userId = getAuthenticatedUserId(req);
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(403).json({ message: "Forbidden" });
      }
      if (user.role === "customer" && conversation.customerId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const messages = await storage.getChatMessages(req.params.id);
      res.json({ conversation, messages });
    } catch (error: any) {
      console.error("Error fetching conversation:", error);
      res.status(500).json({ message: "Failed to fetch conversation" });
    }
  });

  app.get("/api/chat/quick-responses", isAuthenticated, requireRole(["admin", "manager", "mechanic", "receptionist"]), async (req, res) => {
    try {
      const responses = await storage.getChatQuickResponses();
      res.json(responses);
    } catch (error: any) {
      console.error("Error fetching quick responses:", error);
      res.status(500).json({ message: "Failed to fetch quick responses" });
    }
  });

  app.post("/api/chat/quick-responses", isAuthenticated, requireRole(["admin", "manager"]), async (req, res) => {
    try {
      const validated = insertChatQuickResponseSchema.parse({
        ...req.body,
        createdBy: getAuthenticatedUserId(req),
      });
      const response = await storage.createChatQuickResponse(validated);
      res.status(201).json(response);
    } catch (error: any) {
      console.error("Error creating quick response:", error);
      res.status(400).json({ message: error.message || "Failed to create quick response" });
    }
  });

  app.patch("/api/chat/quick-responses/:id", isAuthenticated, requireRole(["admin", "manager"]), async (req, res) => {
    try {
      const validated = updateChatQuickResponseSchema.parse(req.body);
      const response = await storage.updateChatQuickResponse(req.params.id, validated);
      res.json(response);
    } catch (error: any) {
      console.error("Error updating quick response:", error);
      res.status(400).json({ message: error.message || "Failed to update quick response" });
    }
  });

  app.delete("/api/chat/quick-responses/:id", isAuthenticated, requireRole(["admin", "manager"]), async (req, res) => {
    try {
      await storage.deleteChatQuickResponse(req.params.id);
      res.status(204).send();
    } catch (error: any) {
      console.error("Error deleting quick response:", error);
      res.status(500).json({ message: "Failed to delete quick response" });
    }
  });

  // Generate share link for conversation
  app.post("/api/chat/conversations/:id/share", isAuthenticated, async (req, res) => {
    try {
      const conversation = await storage.getChatConversation(req.params.id);
      if (!conversation) {
        return res.status(404).json({ message: "Conversation not found" });
      }

      // Check access - staff can share any, customers only their own
      const userId = getAuthenticatedUserId(req);
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(403).json({ message: "Forbidden" });
      }
      if (user.role === "customer" && conversation.customerId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      // Generate share token if not exists
      let shareToken = conversation.shareToken;
      if (!shareToken) {
        shareToken = crypto.randomUUID();
        await storage.updateChatConversation(req.params.id, { shareToken });
      }

      const shareUrl = `${req.protocol}://${req.get('host')}/chat/shared/${shareToken}`;
      res.json({ shareToken, shareUrl });
    } catch (error: any) {
      console.error("Error generating share link:", error);
      res.status(500).json({ message: "Failed to generate share link" });
    }
  });

  // Get shared conversation (public access via token)
  app.get("/api/chat/conversations/shared/:token", async (req, res) => {
    try {
      const conversation = await storage.getChatConversationByShareToken(req.params.token);
      if (!conversation) {
        return res.status(404).json({ message: "Conversation not found or link expired" });
      }

      const messages = await storage.getChatMessages(conversation.id);

      // Remove sensitive data
      const sanitizedConversation = {
        id: conversation.id,
        createdAt: conversation.createdAt,
        lastMessageAt: conversation.lastMessageAt,
        status: conversation.status,
      };

      res.json({ conversation: sanitizedConversation, messages });
    } catch (error: any) {
      console.error("Error fetching shared conversation:", error);
      res.status(500).json({ message: "Failed to fetch conversation" });
    }
  });

  // Set ACL for chat attachments
  app.post("/api/chat/attachments", isAuthenticated, async (req: any, res) => {
    if (!req.body.fileURL || !req.body.conversationId) {
      return res.status(400).json({ error: "fileURL and conversationId are required" });
    }

    const userId = getAuthenticatedUserId(req);
    try {
      // Verify conversation access
      const conversation = await storage.getChatConversation(req.body.conversationId);
      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      // Check access permission
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(403).json({ error: "Forbidden" });
      }
      if (user.role === "customer" && conversation.customerId !== userId) {
        return res.status(403).json({ error: "Forbidden: Cannot access this conversation" });
      }

      const objectStorageService = new ObjectStorageService();
      const objectPath = await objectStorageService.trySetObjectEntityAclPolicy(
        req.body.fileURL,
        {
          owner: userId,
          visibility: "private",
          aclRules: [
            {
              group: {
                type: ObjectAccessGroupType.STAFF_ROLE,
                id: "staff",
              },
              permission: ObjectPermission.READ,
            },
          ],
        },
      );

      res.status(200).json({ objectPath });
    } catch (error) {
      console.error("Error setting chat attachment ACL:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/chat/customer-conversations", isAuthenticated, async (req, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const conversations = await storage.getChatConversationsByCustomer(userId);
      res.json(conversations);
    } catch (error: any) {
      console.error("Error fetching customer conversations:", error);
      res.status(500).json({ message: "Failed to fetch conversations" });
    }
  });

  // Chat Agent Status Routes
  app.get("/api/chat/agent-status", isAuthenticated, requireRole(["admin", "manager", "mechanic", "receptionist"]), async (req, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const status = await storage.getAgentStatus(userId);
      res.json(status);
    } catch (error: any) {
      console.error("Error fetching agent status:", error);
      res.status(500).json({ message: "Failed to fetch agent status" });
    }
  });

  app.patch("/api/chat/agent-status", isAuthenticated, requireRole(["admin", "manager", "mechanic", "receptionist"]), async (req, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const updates = req.body;
      const status = await storage.upsertAgentStatus(userId, {
        ...updates,
        statusChangedBy: userId,
      });
      res.json(status);
    } catch (error: any) {
      console.error("Error updating agent status:", error);
      res.status(500).json({ message: "Failed to update agent status" });
    }
  });

  app.get("/api/chat/agent-statuses", isAuthenticated, requireRole(["admin", "manager"]), async (req, res) => {
    try {
      const statuses = await storage.getAllAgentStatuses();
      res.json(statuses);
    } catch (error: any) {
      console.error("Error fetching agent statuses:", error);
      res.status(500).json({ message: "Failed to fetch agent statuses" });
    }
  });

  // Chat Routing Settings Routes
  app.get("/api/chat/routing-settings", isAuthenticated, requireRole(["admin", "manager"]), async (req, res) => {
    try {
      const settings = await storage.getChatRoutingSettings();
      res.json(settings);
    } catch (error: any) {
      console.error("Error fetching routing settings:", error);
      res.status(500).json({ message: "Failed to fetch routing settings" });
    }
  });

  app.patch("/api/chat/routing-settings", isAuthenticated, requireRole(["admin", "manager"]), async (req, res) => {
    try {
      const updates = req.body;
      const settings = await storage.updateChatRoutingSettings(updates);
      res.json(settings);
    } catch (error: any) {
      console.error("Error updating routing settings:", error);
      res.status(500).json({ message: "Failed to update routing settings" });
    }
  });

  // Chat Ratings Routes (CSAT)
  app.post("/api/chat/conversations/:id/rate", isAuthenticated, async (req, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const conversation = await storage.getChatConversation(req.params.id);

      if (!conversation) {
        return res.status(404).json({ message: "Conversation not found" });
      }

      // Verify customer owns this conversation
      if (conversation.customerId !== userId) {
        return res.status(403).json({ message: "Not authorized to rate this conversation" });
      }

      // Check if already rated
      const existingRating = await storage.getChatRatingByConversation(req.params.id);
      if (existingRating) {
        return res.status(400).json({ message: "Conversation already rated" });
      }

      // Create rating
      const rating = await storage.createChatRating({
        conversationId: req.params.id,
        customerId: userId,
        staffId: conversation.assignedStaffId!,
        rating: req.body.rating,
        comment: req.body.comment,
      });

      res.json(rating);
    } catch (error: any) {
      console.error("Error creating chat rating:", error);
      res.status(500).json({ message: "Failed to create rating" });
    }
  });

  app.get("/api/chat/ratings/staff/:staffId", isAuthenticated, requireRole(["admin", "manager"]), async (req, res) => {
    try {
      const ratings = await storage.getChatRatingsByStaff(req.params.staffId);
      res.json(ratings);
    } catch (error: any) {
      console.error("Error fetching staff ratings:", error);
      res.status(500).json({ message: "Failed to fetch ratings" });
    }
  });

  // Chat Metrics Routes
  app.get("/api/chat/metrics/agent/:staffId", isAuthenticated, requireRole(["admin", "manager"]), async (req, res) => {
    try {
      const { startDate, endDate } = req.query;

      const metrics = await storage.getAgentPerformanceMetrics(
        req.params.staffId,
        startDate ? new Date(startDate as string) : undefined,
        endDate ? new Date(endDate as string) : undefined
      );

      res.json(metrics);
    } catch (error: any) {
      console.error("Error fetching agent metrics:", error);
      res.status(500).json({ message: "Failed to fetch metrics" });
    }
  });

  app.get("/api/chat/metrics/my-performance", isAuthenticated, requireRole(["mechanic", "receptionist", "manager", "admin"]), async (req, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const { startDate, endDate } = req.query;

      const metrics = await storage.getAgentPerformanceMetrics(
        userId,
        startDate ? new Date(startDate as string) : undefined,
        endDate ? new Date(endDate as string) : undefined
      );

      res.json(metrics);
    } catch (error: any) {
      console.error("Error fetching my metrics:", error);
      res.status(500).json({ message: "Failed to fetch metrics" });
    }
  });

  // Promotional Banners Routes
  // Public endpoint - get active scheduled banners for customer portal
  app.get("/api/banners/active", async (req, res) => {
    try {
      const now = new Date();
      const banners = await db
        .select()
        .from(promotionalBanners)
        .where(
          and(
            eq(promotionalBanners.isActive, true),
            or(
              isNull(promotionalBanners.startDate),
              lte(promotionalBanners.startDate, now)
            ),
            or(
              isNull(promotionalBanners.endDate),
              gte(promotionalBanners.endDate, now)
            )
          )
        )
        .orderBy(asc(promotionalBanners.displayOrder));

      res.json(banners);
    } catch (error: any) {
      console.error("Error fetching active banners:", error);
      res.status(500).json({ message: "Failed to fetch banners" });
    }
  });

  // Admin endpoint - get all banners
  app.get("/api/banners", isAuthenticated, requireRole(["admin", "manager"]), async (req, res) => {
    try {
      const banners = await db
        .select()
        .from(promotionalBanners)
        .orderBy(asc(promotionalBanners.displayOrder));

      res.json(banners);
    } catch (error: any) {
      console.error("Error fetching banners:", error);
      res.status(500).json({ message: "Failed to fetch banners" });
    }
  });

  // Admin endpoint - create banner
  app.post("/api/banners", isAuthenticated, requireRole(["admin", "manager"]), async (req, res) => {
    try {
      // Check banner limit (max 6)
      const existingBanners = await db
        .select({ count: count() })
        .from(promotionalBanners);

      if (existingBanners[0].count >= 6) {
        return res.status(400).json({ message: "Maximum of 6 banners allowed. Please delete an existing banner first." });
      }

      const data = {
        ...req.body,
        startDate: req.body.startDate ? new Date(req.body.startDate) : null,
        endDate: req.body.endDate ? new Date(req.body.endDate) : null,
      };

      const validated = insertPromotionalBannerSchema.parse(data);
      const [banner] = await db.insert(promotionalBanners).values(validated).returning();

      res.status(201).json(banner);
    } catch (error: any) {
      console.error("Error creating banner:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid banner data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create banner" });
    }
  });

  // Admin endpoint - update banner
  app.patch("/api/banners/:id", isAuthenticated, requireRole(["admin", "manager"]), async (req, res) => {
    try {
      const { id } = req.params;
      const data = {
        ...req.body,
        startDate: req.body.startDate ? new Date(req.body.startDate) : undefined,
        endDate: req.body.endDate ? new Date(req.body.endDate) : undefined,
        updatedAt: new Date(),
      };

      const validated = updatePromotionalBannerSchema.parse(data);
      const [banner] = await db
        .update(promotionalBanners)
        .set(validated)
        .where(eq(promotionalBanners.id, id))
        .returning();

      if (!banner) {
        return res.status(404).json({ message: "Banner not found" });
      }

      res.json(banner);
    } catch (error: any) {
      console.error("Error updating banner:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid banner data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update banner" });
    }
  });

  // Admin endpoint - delete banner
  app.delete("/api/banners/:id", isAuthenticated, requireRole(["admin", "manager"]), async (req, res) => {
    try {
      const { id } = req.params;
      const [deleted] = await db
        .delete(promotionalBanners)
        .where(eq(promotionalBanners.id, id))
        .returning();

      if (!deleted) {
        return res.status(404).json({ message: "Banner not found" });
      }

      res.json({ message: "Banner deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting banner:", error);
      res.status(500).json({ message: "Failed to delete banner" });
    }
  });

  // ============================================
  // CRM - LEADS ENDPOINTS
  // ============================================

  // Get all leads with optional filters
  app.get("/api/leads", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req, res) => {
    try {
      const { status, source, assignedToId, search } = req.query;

      const leads = await storage.getAllLeads({
        status: status as string,
        source: source as string,
        assignedToId: assignedToId as string,
        search: search as string,
      });

      res.json(leads);
    } catch (error: any) {
      console.error("Error fetching leads:", error);
      res.status(500).json({ message: "Failed to fetch leads" });
    }
  });

  // Get lead stats for dashboard
  app.get("/api/leads/stats", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req, res) => {
    try {
      const stats = await storage.getLeadStats();
      res.json(stats);
    } catch (error: any) {
      console.error("Error fetching lead stats:", error);
      res.status(500).json({ message: "Failed to fetch lead stats" });
    }
  });

  // Get a single lead by ID
  app.get("/api/leads/:id", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req, res) => {
    try {
      const { id } = req.params;
      const lead = await storage.getLeadById(id);

      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }

      res.json(lead);
    } catch (error: any) {
      console.error("Error fetching lead:", error);
      res.status(500).json({ message: "Failed to fetch lead" });
    }
  });

  // Create a new lead (public endpoint for lead capture forms)
  app.post("/api/leads", async (req, res) => {
    try {
      const validated = insertLeadSchema.parse(req.body);
      const lead = await storage.createLead(validated);

      // Create initial activity log
      await storage.createLeadActivity({
        leadId: lead.id,
        activityType: "note",
        subject: "Lead created",
        description: `Lead created from ${lead.source} source`,
      });

      res.status(201).json(lead);
    } catch (error: any) {
      console.error("Error creating lead:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid lead data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create lead" });
    }
  });

  // Update a lead
  app.patch("/api/leads/:id", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req, res) => {
    try {
      const { id } = req.params;
      const validated = updateLeadSchema.parse(req.body);

      const updated = await storage.updateLead(id, validated);

      if (!updated) {
        return res.status(404).json({ message: "Lead not found" });
      }

      // Log status changes
      if (validated.status) {
        await storage.createLeadActivity({
          leadId: id,
          activityType: "status_change",
          subject: `Status changed to ${validated.status}`,
          description: `Lead status updated to ${validated.status}`,
          performedById: req.user!.id,
        });
      }

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating lead:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid lead data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update lead" });
    }
  });

  // Delete a lead
  app.delete("/api/leads/:id", isAuthenticated, requireRole(["admin", "manager"]), async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteLead(id);

      res.json({ message: "Lead deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting lead:", error);
      res.status(500).json({ message: "Failed to delete lead" });
    }
  });

  // Convert lead to customer
  app.post("/api/leads/:id/convert", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req, res) => {
    try {
      const { id } = req.params;
      const lead = await storage.getLeadById(id);

      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }

      if (lead.status === "converted") {
        return res.status(400).json({ message: "Lead is already converted" });
      }

      // Create customer from lead data
      const customerData = {
        email: lead.email || undefined,
        firstName: lead.firstName,
        lastName: lead.lastName,
        phone: lead.phone || undefined,
        role: "customer" as const,
        customerType: lead.company ? ("business" as const) : ("individual" as const),
        isActive: true,
      };

      const result = await storage.convertLeadToCustomer(id, customerData);

      // Create activity log
      await storage.createLeadActivity({
        leadId: id,
        activityType: "note",
        subject: "Lead converted to customer",
        description: `Lead successfully converted to customer account`,
        performedById: req.user!.id,
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error converting lead:", error);
      res.status(500).json({ message: "Failed to convert lead" });
    }
  });

  // ============================================
  // CRM - LEAD ACTIVITIES ENDPOINTS
  // ============================================

  // Get activities for a lead
  app.get("/api/leads/:leadId/activities", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req, res) => {
    try {
      const { leadId } = req.params;
      const activities = await storage.getLeadActivitiesByLeadId(leadId);

      res.json(activities);
    } catch (error: any) {
      console.error("Error fetching lead activities:", error);
      res.status(500).json({ message: "Failed to fetch lead activities" });
    }
  });

  // Create a lead activity
  app.post("/api/leads/:leadId/activities", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req, res) => {
    try {
      const { leadId } = req.params;

      const data = {
        ...req.body,
        leadId,
        performedById: req.user!.id,
        nextStepDate: req.body.nextStepDate ? new Date(req.body.nextStepDate) : undefined,
      };

      const validated = insertLeadActivitySchema.parse(data);
      const activity = await storage.createLeadActivity(validated);

      res.status(201).json(activity);
    } catch (error: any) {
      console.error("Error creating lead activity:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid activity data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create activity" });
    }
  });

  // Delete a lead activity
  app.delete("/api/lead-activities/:id", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteLeadActivity(id);

      res.json({ message: "Activity deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting activity:", error);
      res.status(500).json({ message: "Failed to delete activity" });
    }
  });

  // ============================================
  // CRM - CUSTOMER TAGS ENDPOINTS
  // ============================================

  // Get all customer tags
  app.get("/api/customer-tags", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req, res) => {
    try {
      const tags = await storage.getAllCustomerTags();
      res.json(tags);
    } catch (error: any) {
      console.error("Error fetching customer tags:", error);
      res.status(500).json({ message: "Failed to fetch customer tags" });
    }
  });

  // Create a customer tag
  app.post("/api/customer-tags", isAuthenticated, requireRole(["admin", "manager"]), async (req, res) => {
    try {
      const validated = insertCustomerTagSchema.parse(req.body);
      const tag = await storage.createCustomerTag(validated);

      res.status(201).json(tag);
    } catch (error: any) {
      console.error("Error creating customer tag:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid tag data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create customer tag" });
    }
  });

  // Update a customer tag
  app.patch("/api/customer-tags/:id", isAuthenticated, requireRole(["admin", "manager"]), async (req, res) => {
    try {
      const { id } = req.params;
      const validated = updateCustomerTagSchema.parse(req.body);

      const updated = await storage.updateCustomerTag(id, validated);

      if (!updated) {
        return res.status(404).json({ message: "Tag not found" });
      }

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating customer tag:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid tag data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update customer tag" });
    }
  });

  // Delete a customer tag
  app.delete("/api/customer-tags/:id", isAuthenticated, requireRole(["admin", "manager"]), async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteCustomerTag(id);

      res.json({ message: "Tag deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting customer tag:", error);
      res.status(500).json({ message: "Failed to delete customer tag" });
    }
  });

  // Get tags for a specific customer
  app.get("/api/customers/:customerId/tags", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req, res) => {
    try {
      const { customerId } = req.params;
      const tags = await storage.getCustomerTags(customerId);

      res.json(tags);
    } catch (error: any) {
      console.error("Error fetching customer tags:", error);
      res.status(500).json({ message: "Failed to fetch customer tags" });
    }
  });

  // Assign a tag to a customer
  app.post("/api/customers/:customerId/tags", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req, res) => {
    try {
      const { customerId } = req.params;
      const { tagId } = req.body;

      const assignment = await storage.assignTagToCustomer({
        customerId,
        tagId,
        assignedById: req.user!.id,
      });

      res.status(201).json(assignment);
    } catch (error: any) {
      console.error("Error assigning tag:", error);
      res.status(500).json({ message: "Failed to assign tag" });
    }
  });

  // Remove a tag from a customer
  app.delete("/api/customers/:customerId/tags/:tagId", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req, res) => {
    try {
      const { customerId, tagId } = req.params;
      await storage.removeTagFromCustomer(customerId, tagId);

      res.json({ message: "Tag removed successfully" });
    } catch (error: any) {
      console.error("Error removing tag:", error);
      res.status(500).json({ message: "Failed to remove tag" });
    }
  });

  // ============================================
  // CRM - CUSTOMER SEGMENTS ENDPOINTS
  // ============================================

  // Get all customer segments
  app.get("/api/customer-segments", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req, res) => {
    try {
      const segments = await storage.getAllCustomerSegments(req.user!.id);
      res.json(segments);
    } catch (error: any) {
      console.error("Error fetching customer segments:", error);
      res.status(500).json({ message: "Failed to fetch customer segments" });
    }
  });

  // Get a specific segment
  app.get("/api/customer-segments/:id", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req, res) => {
    try {
      const { id } = req.params;
      const segment = await storage.getCustomerSegmentById(id);

      if (!segment) {
        return res.status(404).json({ message: "Segment not found" });
      }

      res.json(segment);
    } catch (error: any) {
      console.error("Error fetching customer segment:", error);
      res.status(500).json({ message: "Failed to fetch customer segment" });
    }
  });

  // Create a customer segment
  app.post("/api/customer-segments", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req, res) => {
    try {
      const data = {
        ...req.body,
        createdById: req.user!.id,
      };

      const validated = insertCustomerSegmentSchema.parse(data);
      const segment = await storage.createCustomerSegment(validated);

      res.status(201).json(segment);
    } catch (error: any) {
      console.error("Error creating customer segment:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid segment data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create customer segment" });
    }
  });

  // Update a customer segment
  app.patch("/api/customer-segments/:id", isAuthenticated, requireRole(["admin", "manager", "receptionist"]), async (req, res) => {
    try {
      const { id } = req.params;
      const validated = updateCustomerSegmentSchema.parse(req.body);

      const updated = await storage.updateCustomerSegment(id, validated);

      if (!updated) {
        return res.status(404).json({ message: "Segment not found" });
      }

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating customer segment:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid segment data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update customer segment" });
    }
  });

  // Delete a customer segment
  app.delete("/api/customer-segments/:id", isAuthenticated, requireRole(["admin", "manager"]), async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteCustomerSegment(id);

      res.json({ message: "Segment deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting customer segment:", error);
      res.status(500).json({ message: "Failed to delete customer segment" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
