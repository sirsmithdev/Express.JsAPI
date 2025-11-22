# 316 Auto - Mobile API Documentation

## Overview

This document provides comprehensive documentation for the 316 Auto REST API, designed for mobile app integration and third-party access. The API uses JWT (JSON Web Token) authentication for stateless, scalable mobile app communication.

## Base URL

- **Development**: `http://localhost:5000`
- **Production (Railway)**: `https://your-api-domain.railway.app`

## Authentication

The API supports two authentication methods:

### 1. Session-Based Authentication (Web Only)
Used by the web application with cookie-based sessions.

### 2. JWT Token Authentication (Mobile Apps)
Used by mobile applications with Bearer tokens.

#### JWT Token Flow

1. **Login**: POST to `/api/mobile/auth/login` with email/password
2. **Receive Tokens**: Get `accessToken` (15min) and `refreshToken` (7 days)
3. **Use Access Token**: Include in `Authorization: Bearer <token>` header
4. **Refresh Token**: When access token expires, POST to `/api/mobile/auth/refresh`

#### Token Expiration
- **Access Token**: 15 minutes
- **Refresh Token**: 7 days

## Mobile Authentication Endpoints

### POST /api/mobile/auth/login
Login and receive JWT tokens.

**Request Body**:
```json
{
  "email": "customer@example.com",
  "password": "SecurePassword123"
}
```

**Success Response** (200):
```json
{
  "user": {
    "id": 123,
    "email": "customer@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "role": "customer",
    "isActive": true,
    "phone": "+1234567890"
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Error Responses**:
- `400`: Missing email or password
- `401`: Invalid credentials
- `403`: Account deactivated

---

### POST /api/mobile/auth/register
Register a new customer account.

**Request Body**:
```json
{
  "email": "newuser@example.com",
  "password": "SecurePassword123",
  "firstName": "Jane",
  "lastName": "Smith",
  "phone": "+1234567890",
  "customerType": "individual",
  "referralCode": "JOHN123" // optional
}
```

**Success Response** (201):
```json
{
  "user": {
    "id": 124,
    "email": "newuser@example.com",
    "firstName": "Jane",
    "lastName": "Smith",
    "role": "customer",
    "isActive": true,
    "referralCode": "JANE456"
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "message": "Registration successful!"
}
```

**Validation Requirements**:
- Email: Valid email format
- Password: Minimum 8 characters
- Referral code: Must be valid if provided

**Error Responses**:
- `400`: Invalid input or email already registered
- `500`: Server error

---

### POST /api/mobile/auth/refresh
Refresh expired access token using refresh token.

**Request Body**:
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Success Response** (200):
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Error Responses**:
- `400`: Missing refresh token
- `401`: Invalid or expired refresh token, or user account deactivated

---

### GET /api/mobile/auth/user
Get current authenticated user details.

**Headers**:
```
Authorization: Bearer <accessToken>
```

**Success Response** (200):
```json
{
  "id": 123,
  "email": "customer@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "role": "customer",
  "isActive": true,
  "phone": "+1234567890",
  "loyaltyPoints": 250,
  "referralCode": "JOHN123"
}
```

**Error Responses**:
- `401`: Missing, invalid, or expired token
- `500`: Server error

---

## Customer Portal Endpoints

All endpoints below require JWT authentication via `Authorization: Bearer <token>` header.

### Appointments

#### GET /api/appointments
Get all appointments for the authenticated customer.

**Success Response** (200):
```json
[
  {
    "id": 1,
    "customerId": 123,
    "vehicleId": 45,
    "serviceType": "Oil Change",
    "scheduledDate": "2024-01-15T10:00:00Z",
    "status": "scheduled",
    "notes": "Regular maintenance"
  }
]
```

#### POST /api/appointments
Create a new appointment.

**Request Body**:
```json
{
  "vehicleId": 45,
  "serviceType": "Oil Change",
  "scheduledDate": "2024-01-15T10:00:00Z",
  "notes": "Regular maintenance"
}
```

**Success Response** (201):
```json
{
  "id": 2,
  "customerId": 123,
  "vehicleId": 45,
  "serviceType": "Oil Change",
  "scheduledDate": "2024-01-15T10:00:00Z",
  "status": "scheduled",
  "notes": "Regular maintenance"
}
```

#### PATCH /api/appointments/:id
Update an appointment (customer can only update their own).

**Request Body**:
```json
{
  "scheduledDate": "2024-01-16T14:00:00Z",
  "notes": "Changed time"
}
```

#### DELETE /api/appointments/:id
Cancel an appointment.

---

### Vehicles

#### GET /api/vehicles
Get all vehicles for the authenticated customer.

**Success Response** (200):
```json
[
  {
    "id": 45,
    "customerId": 123,
    "make": "Toyota",
    "model": "Camry",
    "year": 2020,
    "licensePlate": "ABC123",
    "vin": "1HGBH41JXMN109186",
    "color": "Blue",
    "mileage": 45000
  }
]
```

#### POST /api/vehicles
Add a new vehicle.

**Request Body**:
```json
{
  "make": "Honda",
  "model": "Accord",
  "year": 2021,
  "licensePlate": "XYZ789",
  "vin": "1HGCP2F3XCA123456",
  "color": "Silver",
  "mileage": 12000
}
```

#### PATCH /api/vehicles/:id
Update vehicle information.

#### DELETE /api/vehicles/:id
Remove a vehicle.

---

### Job Cards

#### GET /api/job-cards
Get all job cards for the customer's vehicles.

**Query Parameters**:
- `status`: Filter by status (pending, in_progress, completed, etc.)
- `vehicleId`: Filter by specific vehicle

**Success Response** (200):
```json
[
  {
    "id": 10,
    "vehicleId": 45,
    "status": "completed",
    "description": "Oil change and tire rotation",
    "scheduledDate": "2024-01-10T09:00:00Z",
    "completedDate": "2024-01-10T11:30:00Z",
    "totalCost": 89.99,
    "mechanicName": "Mike Johnson"
  }
]
```

#### GET /api/job-cards/:id
Get detailed job card information including tasks and parts.

**Success Response** (200):
```json
{
  "id": 10,
  "vehicleId": 45,
  "status": "completed",
  "description": "Oil change and tire rotation",
  "tasks": [
    {
      "id": 1,
      "description": "Change engine oil",
      "status": "completed",
      "laborTime": 30
    }
  ],
  "parts": [
    {
      "id": 1,
      "partName": "Synthetic Oil 5W-30",
      "quantity": 5,
      "unitPrice": 8.99,
      "totalPrice": 44.95
    }
  ],
  "totalCost": 89.99
}
```

---

### Invoices

#### GET /api/invoices
Get all invoices for the authenticated customer.

**Query Parameters**:
- `status`: Filter by payment status (paid, pending, overdue)

**Success Response** (200):
```json
[
  {
    "id": 5,
    "invoiceNumber": "INV-2024-00005",
    "customerId": 123,
    "jobCardId": 10,
    "total": 89.99,
    "status": "paid",
    "dueDate": "2024-01-17T00:00:00Z",
    "paidDate": "2024-01-12T14:22:00Z"
  }
]
```

#### GET /api/invoices/:id
Get detailed invoice information.

#### GET /api/invoices/:id/pdf
Download invoice as PDF.

---

### Loyalty & Referrals

#### GET /api/loyalty/points
Get customer's loyalty points balance and history.

**Success Response** (200):
```json
{
  "currentPoints": 250,
  "lifetimePoints": 450,
  "transactions": [
    {
      "id": 1,
      "points": 50,
      "type": "service",
      "description": "Points earned for oil change",
      "date": "2024-01-10T11:30:00Z"
    },
    {
      "id": 2,
      "points": 100,
      "type": "referral",
      "description": "Referred a new customer",
      "date": "2024-01-12T09:00:00Z"
    }
  ]
}
```

#### POST /api/loyalty/redeem
Redeem loyalty points for coupons.

**Request Body**:
```json
{
  "points": 100
}
```

#### GET /api/referrals
Get referral information and statistics.

**Success Response** (200):
```json
{
  "referralCode": "JOHN123",
  "totalReferrals": 3,
  "pointsEarned": 300,
  "referrals": [
    {
      "referredName": "Jane Smith",
      "joinDate": "2024-01-12T09:00:00Z",
      "pointsAwarded": 100
    }
  ]
}
```

---

### Coupons

#### GET /api/coupons
Get all available and customer-owned coupons.

**Success Response** (200):
```json
[
  {
    "id": 1,
    "code": "SAVE20",
    "discountType": "percentage",
    "discountValue": 20,
    "validUntil": "2024-12-31T23:59:59Z",
    "isUsed": false
  }
]
```

---

### Inspections

#### GET /api/inspections
Get vehicle inspection reports.

**Query Parameters**:
- `vehicleId`: Filter by specific vehicle

**Success Response** (200):
```json
[
  {
    "id": 3,
    "inspectionNumber": "INSP-2024-00003",
    "vehicleId": 45,
    "inspectorName": "Tom Wilson",
    "inspectionDate": "2024-01-10T10:00:00Z",
    "overallCondition": "good",
    "items": [
      {
        "component": "Brakes",
        "condition": "good",
        "notes": "Front pads at 60%"
      }
    ]
  }
]
```

#### GET /api/inspections/:id/pdf
Download inspection report as PDF.

---

### Towing Requests

#### POST /api/tow-requests
Create a new towing request.

**Request Body**:
```json
{
  "vehicleId": 45,
  "pickupLocation": {
    "address": "123 Main St, City, State 12345",
    "latitude": 40.7128,
    "longitude": -74.0060
  },
  "dropoffLocation": {
    "address": "456 Oak Ave, City, State 12345",
    "latitude": 40.7589,
    "longitude": -73.9851
  },
  "serviceType": "standard",
  "urgency": "normal",
  "photos": ["photo1.jpg", "photo2.jpg"],
  "notes": "Car won't start"
}
```

**Success Response** (201):
```json
{
  "id": 7,
  "requestNumber": "TOW-2024-00007",
  "status": "pending",
  "estimatedCost": 125.00,
  "estimatedArrival": "45 minutes"
}
```

#### GET /api/tow-requests
Get all towing requests for the customer.

#### GET /api/tow-requests/:id
Get detailed towing request status and updates.

---

## Staff Portal Endpoints

These endpoints require staff role authorization (`admin`, `manager`, `mechanic`, or `receptionist`).

### Job Card Management

#### GET /api/staff/job-cards
Get all job cards (staff view with filters).

**Query Parameters**:
- `status`: Filter by status
- `mechanicId`: Filter by assigned mechanic
- `startDate`, `endDate`: Date range filter

#### PATCH /api/staff/job-cards/:id
Update job card (assign mechanic, update status, add notes).

#### POST /api/staff/job-cards/:id/tasks
Add tasks to a job card.

#### POST /api/staff/job-cards/:id/parts
Add parts to a job card.

---

### Customer Management

#### GET /api/staff/customers
Get all customers with search and filters.

**Query Parameters**:
- `search`: Search by name, email, or phone
- `customerType`: Filter by type (individual, business)
- `tag`: Filter by customer tag

#### POST /api/staff/customers
Create a new customer (receptionist/admin).

#### PATCH /api/staff/customers/:id
Update customer information.

---

### Inventory Management

#### GET /api/parts
Get parts inventory.

**Query Parameters**:
- `search`: Search by part name or SKU
- `lowStock`: Filter by low stock items

#### POST /api/parts
Add new part to inventory.

#### PATCH /api/parts/:id
Update part information or stock level.

---

## Error Handling

All API endpoints follow consistent error response formats:

**Error Response Structure**:
```json
{
  "message": "Error description",
  "code": "ERROR_CODE",  // optional
  "details": {}           // optional additional context
}
```

**Common HTTP Status Codes**:
- `200`: Success
- `201`: Created successfully
- `400`: Bad request (validation error)
- `401`: Unauthorized (missing or invalid token)
- `403`: Forbidden (insufficient permissions)
- `404`: Resource not found
- `500`: Internal server error

---

## Rate Limiting

To ensure fair usage and system stability:
- **Development**: No rate limiting
- **Production**: 100 requests per minute per IP address

Exceeding rate limits returns:
```json
{
  "message": "Too many requests. Please try again later.",
  "retryAfter": 60
}
```

---

## Webhooks (Future Implementation)

Planned webhook events for real-time updates:
- `appointment.created`
- `appointment.updated`
- `job_card.completed`
- `invoice.paid`
- `tow_request.status_changed`

---

## Environment Variables

Required environment variables for mobile API:

```bash
# JWT Authentication
JWT_SECRET=your-secret-key-min-32-chars
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# CORS Configuration
WEB_APP_URL=https://your-web-app.com
MOBILE_APP_ORIGIN=capacitor://localhost  # For Capacitor apps

# Database (PostgreSQL)
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# Object Storage (Railway S3)
STORAGE_PROVIDER=s3
S3_ACCESS_KEY_ID=your-access-key
S3_SECRET_ACCESS_KEY=your-secret-key
S3_BUCKET_NAME=your-bucket
S3_REGION=us-west-2
S3_ENDPOINT=https://s3.us-west-2.amazonaws.com

# Session (Web only)
SESSION_SECRET=your-session-secret
```

---

## Mobile App Integration Example

### React Native / Expo

```typescript
// API client setup
import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

const API_BASE_URL = 'https://your-api.railway.app';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
apiClient.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor to handle token refresh
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      
      try {
        const refreshToken = await SecureStore.getItemAsync('refreshToken');
        const { data } = await axios.post(`${API_BASE_URL}/api/mobile/auth/refresh`, {
          refreshToken,
        });
        
        await SecureStore.setItemAsync('accessToken', data.accessToken);
        await SecureStore.setItemAsync('refreshToken', data.refreshToken);
        
        originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
        return apiClient(originalRequest);
      } catch (refreshError) {
        // Refresh failed, redirect to login
        await SecureStore.deleteItemAsync('accessToken');
        await SecureStore.deleteItemAsync('refreshToken');
        // Navigate to login screen
        return Promise.reject(refreshError);
      }
    }
    
    return Promise.reject(error);
  }
);

// Authentication service
export const authService = {
  async login(email: string, password: string) {
    const { data } = await apiClient.post('/api/mobile/auth/login', {
      email,
      password,
    });
    
    await SecureStore.setItemAsync('accessToken', data.accessToken);
    await SecureStore.setItemAsync('refreshToken', data.refreshToken);
    
    return data.user;
  },
  
  async register(userData: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone?: string;
  }) {
    const { data } = await apiClient.post('/api/mobile/auth/register', userData);
    
    await SecureStore.setItemAsync('accessToken', data.accessToken);
    await SecureStore.setItemAsync('refreshToken', data.refreshToken);
    
    return data.user;
  },
  
  async logout() {
    await SecureStore.deleteItemAsync('accessToken');
    await SecureStore.deleteItemAsync('refreshToken');
  },
  
  async getCurrentUser() {
    const { data } = await apiClient.get('/api/mobile/auth/user');
    return data;
  },
};

// Example: Fetch appointments
export const appointmentsService = {
  async getAppointments() {
    const { data } = await apiClient.get('/api/appointments');
    return data;
  },
  
  async createAppointment(appointment: {
    vehicleId: number;
    serviceType: string;
    scheduledDate: string;
    notes?: string;
  }) {
    const { data } = await apiClient.post('/api/appointments', appointment);
    return data;
  },
};
```

---

## Testing the API

### Using cURL

```bash
# Login
curl -X POST http://localhost:5000/api/mobile/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"customer@example.com","password":"password123"}'

# Get user info with token
curl -X GET http://localhost:5000/api/mobile/auth/user \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"

# Create appointment
curl -X POST http://localhost:5000/api/appointments \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "vehicleId": 1,
    "serviceType": "Oil Change",
    "scheduledDate": "2024-01-15T10:00:00Z"
  }'
```

### Using Postman

1. Create a new collection "316 Auto API"
2. Set environment variables:
   - `baseUrl`: `http://localhost:5000` or your production URL
   - `accessToken`: Will be set automatically
3. Create a login request and use Tests tab to save token:
```javascript
const response = pm.response.json();
pm.environment.set("accessToken", response.accessToken);
pm.environment.set("refreshToken", response.refreshToken);
```
4. In other requests, use `{{accessToken}}` in Authorization header

---

## Support

For API support or questions:
- **Email**: support@316auto.com
- **Documentation**: https://docs.316auto.com
- **Status Page**: https://status.316auto.com

---

## Changelog

### Version 1.0.0 (2024-01-15)
- Initial mobile API release
- JWT authentication implementation
- Customer portal endpoints
- Staff portal endpoints
- CORS configuration for mobile apps
