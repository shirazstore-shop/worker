import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Client } from "@sdk/server-types";
import { tables, buckets } from "@generated";
import { eq, desc, like, or, and } from "drizzle-orm";
import { successResponse, errorResponse } from "./utils/response";

export async function createApp(
  edgespark: Client<typeof tables>
): Promise<Hono> {
  const app = new Hono();

  // Enable CORS for all routes
  app.use('/*', cors());

  // ============================================
  // PUBLIC ENDPOINTS
  // ============================================

  // Public: Get all devices (product catalog)
  app.get('/api/public/devices', async (c) => {
    console.log("[API] GET /api/public/devices - fetching all devices");
    const deviceList = await edgespark.db.select().from(tables.devices);
    console.log("[API] GET /api/public/devices - found", deviceList.length, "devices");
    return c.json(successResponse(deviceList));
  });

  // Public: Secure Order Access (Login to Dashboard)
  app.post('/api/public/order-access', async (c) => {
    const body = await c.req.json();
    const { email, reference } = body;
    
    console.log("[API] POST /api/public/order-access - attempt for:", email);

    if (!email || !reference) {
      return c.json(errorResponse('Email and Order/Tracking Number are required', 400), 400);
    }

    // Find order matching email AND (orderNumber OR trackingNumber)
    const orderList = await edgespark.db.select()
      .from(tables.orders)
      .where(and(
        eq(tables.orders.customerEmail, email),
        or(
          eq(tables.orders.orderNumber, reference),
          eq(tables.orders.trackingNumber, reference)
        )
      ))
      .limit(1);

    const order = orderList[0];

    if (!order) {
      console.log("[API] POST /api/public/order-access - no match found");
      return c.json(errorResponse('Order not found or email does not match', 401), 401);
    }

    // Get device details
    let device = null;
    if (order.deviceId) {
      const deviceList = await edgespark.db.select()
        .from(tables.devices)
        .where(eq(tables.devices.id, order.deviceId))
        .limit(1);
      device = deviceList[0];
    }

    // Get tracking events
    const events = await edgespark.db.select()
      .from(tables.trackingEvents)
      .where(eq(tables.trackingEvents.orderId, order.id))
      .orderBy(desc(tables.trackingEvents.id));

    console.log("[API] POST /api/public/order-access - success for:", order.orderNumber);
    
    return c.json(successResponse({
      order: {
        ...order,
        device: device
      },
      timeline: events
    }));
  });

  // ============================================
  // USER MANAGEMENT
  // ============================================

  // Sync User (Call on login)
  app.post('/api/users/sync', async (c) => {
    const user = edgespark.auth.user!; // Guaranteed by framework

    // 1. Check by Auth ID
    const existingByAuth = await edgespark.db.select().from(tables.appUsers).where(eq(tables.appUsers.authId, user.id)).limit(1);
    
    if (existingByAuth.length > 0) {
      return c.json(successResponse({ user: existingByAuth[0] }));
    }

    // 2. Check by Email (Pre-authorized users)
    if (user.email) {
      const existingByEmail = await edgespark.db.select().from(tables.appUsers).where(eq(tables.appUsers.email, user.email)).limit(1);
      
      if (existingByEmail.length > 0) {
        // Update Auth ID to link the account
        const updatedUser = await edgespark.db.update(tables.appUsers)
          .set({ authId: user.id, name: user.name })
          .where(eq(tables.appUsers.id, existingByEmail[0].id))
          .returning();
        return c.json(successResponse({ user: updatedUser[0] }));
      }
    }

    // 3. Create new user
    const newUser = await edgespark.db.insert(tables.appUsers).values({
      authId: user.id,
      email: user.email || '',
      name: user.name,
      role: 'user', // Default role
      createdAt: new Date().toISOString()
    }).returning();
    return c.json(successResponse({ user: newUser[0] }));
  });

  // List Users (Admin only)
  app.get('/api/users', async (c) => {
    const user = edgespark.auth.user!;
    
    const appUser = await edgespark.db.select().from(tables.appUsers).where(eq(tables.appUsers.authId, user.id)).limit(1);
    if (appUser[0]?.role !== 'admin' && appUser[0]?.role !== 'database_admin') return c.json(errorResponse('Forbidden', 403), 403);

    const users = await edgespark.db.select().from(tables.appUsers);
    return c.json(successResponse(users));
  });

  // Update Role
  app.put('/api/users/:id/role', async (c) => {
    const user = edgespark.auth.user!;
    const appUser = await edgespark.db.select().from(tables.appUsers).where(eq(tables.appUsers.authId, user.id)).limit(1);
    if (appUser[0]?.role !== 'admin' && appUser[0]?.role !== 'database_admin') return c.json(errorResponse('Forbidden', 403), 403);

    const id = parseInt(c.req.param('id'));
    const { role } = await c.req.json();
    
    await edgespark.db.update(tables.appUsers).set({ role }).where(eq(tables.appUsers.id, id));
    return c.json(successResponse({ success: true }));
  });

  // Link Order to User
  app.post('/api/users/link-order', async (c) => {
    const { userId, orderIdentifier } = await c.req.json();
    
    // Find order
    const order = await edgespark.db.select().from(tables.orders).where(or(
      eq(tables.orders.orderNumber, orderIdentifier),
      eq(tables.orders.trackingNumber, orderIdentifier),
      eq(tables.orders.id, parseInt(orderIdentifier) || 0)
    )).limit(1);

    if (!order[0]) return c.json(errorResponse('Order not found', 404), 404);

    await edgespark.db.update(tables.orders).set({ userId }).where(eq(tables.orders.id, order[0].id));
    return c.json(successResponse({ success: true }));
  });

  // ============================================
  // ASSET MANAGEMENT
  // ============================================

  // Upload Asset
  app.post('/api/assets/upload', async (c) => {
    const user = edgespark.auth.user!;
    const appUser = await edgespark.db.select().from(tables.appUsers).where(eq(tables.appUsers.authId, user.id)).limit(1);
    if (appUser[0]?.role !== 'admin' && appUser[0]?.role !== 'database_admin') return c.json(errorResponse('Forbidden', 403), 403);

    const body = await c.req.parseBody();
    const file = body['file']; 

    if (!file || typeof file === 'string') {
      return c.json(errorResponse('No file uploaded', 400), 400);
    }

    const filename = file.name;
    const buffer = await file.arrayBuffer();
    
    // Upload to R2
    const key = `${Date.now()}-${filename}`;
    await edgespark.storage.from(buckets.assets).put(key, buffer, {
      contentType: file.type
    });

    // Store S3 URI in DB
    const s3Uri = edgespark.storage.toS3Uri(buckets.assets, key);

    // Insert into DB
    const asset = await edgespark.db.insert(tables.assets).values({
      filename: filename,
      url: s3Uri,
      size: file.size,
      mimeType: file.type,
      uploadedAt: new Date().toISOString()
    }).returning();

    return c.json(successResponse(asset[0]));
  });

  // List Assets
  app.get('/api/assets', async (c) => {
    const user = edgespark.auth.user!;
    const appUser = await edgespark.db.select().from(tables.appUsers).where(eq(tables.appUsers.authId, user.id)).limit(1);
    if (appUser[0]?.role !== 'admin' && appUser[0]?.role !== 'database_admin') return c.json(errorResponse('Forbidden', 403), 403);

    const assets = await edgespark.db.select().from(tables.assets).orderBy(desc(tables.assets.uploadedAt));
    
    // Generate presigned URLs
    const assetsWithUrls = await Promise.all(assets.map(async (a) => {
      if (!a.url) return a;
      try {
        const { path } = edgespark.storage.fromS3Uri(a.url);
        const { downloadUrl } = await edgespark.storage.from(buckets.assets).createPresignedGetUrl(path, 3600); // 1 hour
        return { ...a, downloadUrl, error: null };
      } catch (e) {
        console.error("Failed to generate URL for:", a.filename, e);
        return { ...a, downloadUrl: a.url, error: "Failed to generate secure URL" };
      }
    }));

    return c.json(successResponse(assetsWithUrls));
  });

  // Delete Asset
  app.delete('/api/assets/:id', async (c) => {
    const user = edgespark.auth.user!;
    const appUser = await edgespark.db.select().from(tables.appUsers).where(eq(tables.appUsers.authId, user.id)).limit(1);
    if (appUser[0]?.role !== 'admin' && appUser[0]?.role !== 'database_admin') return c.json(errorResponse('Forbidden', 403), 403);

    const id = parseInt(c.req.param('id'));
    const asset = await edgespark.db.select().from(tables.assets).where(eq(tables.assets.id, id)).limit(1);
    
    if (!asset[0]) return c.json(errorResponse('Not found', 404), 404);

    // Delete from Storage
    try {
      const { path } = edgespark.storage.fromS3Uri(asset[0].url);
      await edgespark.storage.from(buckets.assets).delete(path);
    } catch (e) {
      console.error("Failed to delete from storage", e);
    }

    // Delete from DB
    await edgespark.db.delete(tables.assets).where(eq(tables.assets.id, id));
    return c.json(successResponse({ success: true }));
  });

  // ============================================
  // ADMIN ENDPOINTS - DEVICES
  // ============================================

  // Admin: Get all devices (Protected)
  app.get('/api/devices', async (c) => {
    const user = edgespark.auth.user!;
    const appUser = await edgespark.db.select().from(tables.appUsers).where(eq(tables.appUsers.authId, user.id)).limit(1);
    if (appUser[0]?.role !== 'admin' && appUser[0]?.role !== 'database_admin') return c.json(errorResponse('Forbidden', 403), 403);

    const deviceList = await edgespark.db.select().from(tables.devices);
    return c.json(successResponse(deviceList));
  });

  // Admin: Create Device
  app.post('/api/devices', async (c) => {
    const user = edgespark.auth.user!;
    const appUser = await edgespark.db.select().from(tables.appUsers).where(eq(tables.appUsers.authId, user.id)).limit(1);
    if (appUser[0]?.role !== 'admin' && appUser[0]?.role !== 'database_admin') return c.json(errorResponse('Forbidden', 403), 403);

    const body = await c.req.json();
    const result = await edgespark.db.insert(tables.devices).values({
      model: body.model,
      name: body.name,
      description: body.description,
      color: body.color,
      storage: body.storage,
      price: body.price,
      imageUrl: body.imageUrl
    }).returning();
    return c.json(successResponse(result[0]));
  });

  // Admin: Update Device
  app.put('/api/devices/:id', async (c) => {
    const user = edgespark.auth.user!;
    const appUser = await edgespark.db.select().from(tables.appUsers).where(eq(tables.appUsers.authId, user.id)).limit(1);
    if (appUser[0]?.role !== 'admin' && appUser[0]?.role !== 'database_admin') return c.json(errorResponse('Forbidden', 403), 403);

    const id = parseInt(c.req.param('id'));
    const body = await c.req.json();
    
    await edgespark.db.update(tables.devices)
      .set({
        model: body.model,
        name: body.name,
        description: body.description,
        color: body.color,
        storage: body.storage,
        price: body.price,
        imageUrl: body.imageUrl
      })
      .where(eq(tables.devices.id, id));
      
    return c.json(successResponse({ success: true }));
  });

  // Admin: Delete Device
  app.delete('/api/devices/:id', async (c) => {
    const user = edgespark.auth.user!;
    const appUser = await edgespark.db.select().from(tables.appUsers).where(eq(tables.appUsers.authId, user.id)).limit(1);
    if (appUser[0]?.role !== 'admin' && appUser[0]?.role !== 'database_admin') return c.json(errorResponse('Forbidden', 403), 403);

    const id = parseInt(c.req.param('id'));
    await edgespark.db.delete(tables.devices).where(eq(tables.devices.id, id));
    return c.json(successResponse({ success: true }));
  });

  // ============================================
  // ADMIN ENDPOINTS - ORDERS
  // ============================================

  // Admin: Get all orders (Protected)
  app.get('/api/orders', async (c) => {
    const user = edgespark.auth.user!;
    const appUser = await edgespark.db.select().from(tables.appUsers).where(eq(tables.appUsers.authId, user.id)).limit(1);
    if (appUser[0]?.role !== 'admin' && appUser[0]?.role !== 'database_admin') return c.json(errorResponse('Forbidden', 403), 403);

    const orderList = await edgespark.db.select({
      order: tables.orders,
      device: tables.devices,
      user: tables.appUsers
    })
    .from(tables.orders)
    .leftJoin(
      tables.devices,
      eq(tables.orders.deviceId, tables.devices.id)
    )
    .leftJoin(
      tables.appUsers,
      eq(tables.orders.userId, tables.appUsers.id)
    )
    .orderBy(desc(tables.orders.createdAt));

    return c.json(successResponse(orderList));
  });

  // Admin: Create Order
  app.post('/api/orders', async (c) => {
    const user = edgespark.auth.user!;
    const appUser = await edgespark.db.select().from(tables.appUsers).where(eq(tables.appUsers.authId, user.id)).limit(1);
    if (appUser[0]?.role !== 'admin' && appUser[0]?.role !== 'database_admin') return c.json(errorResponse('Forbidden', 403), 403);

    const body = await c.req.json();
    const result = await edgespark.db.insert(tables.orders).values({
      orderNumber: body.orderNumber,
      trackingNumber: body.trackingNumber,
      deviceId: body.deviceId ? parseInt(body.deviceId) : null,
      userId: body.userId ? parseInt(body.userId) : null,
      customerName: body.customerName,
      customerEmail: body.customerEmail,
      status: body.status || 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }).returning();
    return c.json(successResponse(result[0]));
  });

  // Admin: Update Order
  app.put('/api/orders/:id', async (c) => {
    const user = edgespark.auth.user!;
    const appUser = await edgespark.db.select().from(tables.appUsers).where(eq(tables.appUsers.authId, user.id)).limit(1);
    if (appUser[0]?.role !== 'admin' && appUser[0]?.role !== 'database_admin') return c.json(errorResponse('Forbidden', 403), 403);

    const id = parseInt(c.req.param('id'));
    const body = await c.req.json();
    
    await edgespark.db.update(tables.orders)
      .set({
        orderNumber: body.orderNumber,
        trackingNumber: body.trackingNumber,
        deviceId: body.deviceId ? parseInt(body.deviceId) : null,
        userId: body.userId ? parseInt(body.userId) : null,
        customerName: body.customerName,
        customerEmail: body.customerEmail,
        status: body.status,
        updatedAt: new Date().toISOString()
      })
      .where(eq(tables.orders.id, id));
      
    return c.json(successResponse({ success: true }));
  });

  // Admin: Delete Order
  app.delete('/api/orders/:id', async (c) => {
    const user = edgespark.auth.user!;
    const appUser = await edgespark.db.select().from(tables.appUsers).where(eq(tables.appUsers.authId, user.id)).limit(1);
    if (appUser[0]?.role !== 'admin' && appUser[0]?.role !== 'database_admin') return c.json(errorResponse('Forbidden', 403), 403);

    const id = parseInt(c.req.param('id'));
    await edgespark.db.delete(tables.orders).where(eq(tables.orders.id, id));
    return c.json(successResponse({ success: true }));
  });

  // ============================================
  // ADMIN ENDPOINTS - TRACKING
  // ============================================

  // Admin: Get tracking events for order
  app.get('/api/orders/:id/events', async (c) => {
    const user = edgespark.auth.user!;
    const appUser = await edgespark.db.select().from(tables.appUsers).where(eq(tables.appUsers.authId, user.id)).limit(1);
    if (appUser[0]?.role !== 'admin' && appUser[0]?.role !== 'database_admin') return c.json(errorResponse('Forbidden', 403), 403);

    const id = parseInt(c.req.param('id'));
    const events = await edgespark.db.select()
      .from(tables.trackingEvents)
      .where(eq(tables.trackingEvents.orderId, id))
      .orderBy(desc(tables.trackingEvents.timestamp));
      
    return c.json(successResponse(events));
  });

  // Admin: Add tracking event
  app.post('/api/tracking', async (c) => {
    const user = edgespark.auth.user!;
    const appUser = await edgespark.db.select().from(tables.appUsers).where(eq(tables.appUsers.authId, user.id)).limit(1);
    if (appUser[0]?.role !== 'admin' && appUser[0]?.role !== 'database_admin') return c.json(errorResponse('Forbidden', 403), 403);

    const body = await c.req.json();
    const result = await edgespark.db.insert(tables.trackingEvents).values({
      orderId: parseInt(body.orderId),
      status: body.status,
      location: body.location,
      description: body.description,
      timestamp: new Date().toISOString()
    }).returning();
    
    return c.json(successResponse(result[0]));
  });

  // Admin: Update tracking event
  app.put('/api/tracking/:id', async (c) => {
    const user = edgespark.auth.user!;
    const appUser = await edgespark.db.select().from(tables.appUsers).where(eq(tables.appUsers.authId, user.id)).limit(1);
    if (appUser[0]?.role !== 'admin' && appUser[0]?.role !== 'database_admin') return c.json(errorResponse('Forbidden', 403), 403);

    const id = parseInt(c.req.param('id'));
    const body = await c.req.json();
    
    await edgespark.db.update(tables.trackingEvents)
      .set({
        status: body.status,
        location: body.location,
        description: body.description,
        timestamp: body.timestamp || new Date().toISOString()
      })
      .where(eq(tables.trackingEvents.id, id));
      
    return c.json(successResponse({ success: true }));
  });

  // Admin: Delete tracking event
  app.delete('/api/tracking/:id', async (c) => {
    const user = edgespark.auth.user!;
    const appUser = await edgespark.db.select().from(tables.appUsers).where(eq(tables.appUsers.authId, user.id)).limit(1);
    if (appUser[0]?.role !== 'admin' && appUser[0]?.role !== 'database_admin') return c.json(errorResponse('Forbidden', 403), 403);

    const id = parseInt(c.req.param('id'));
    await edgespark.db.delete(tables.trackingEvents).where(eq(tables.trackingEvents.id, id));
    return c.json(successResponse({ success: true }));
  });

  return app;
}
