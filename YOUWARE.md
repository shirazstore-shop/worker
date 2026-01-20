# Gadget Order Tracking System

## Project Overview
A gadget order tracking system for managing Apple device orders with real-time package tracking.

## Technology Stack
- **Frontend**: Vanilla JS + Vite
- **Backend**: Youbase (Hono + Drizzle ORM)
- **Database**: D1 (SQLite)
- **Storage**: R2 (Bucket: `assets`)
- **Auth**: Built-in Youbase auth

## Backend URL
- Staging: `https://staging--lujlgtmiqfc8uzc6ury0.youbase.cloud`

## Database Schema
- **app_users**: User profiles (linked to Auth via `auth_id`)
- **assets**: File metadata (filename, url, size, mime_type)
- **devices**: Product catalog (model, name, description, color, storage, price, quantity)
- **orders**: Customer orders (linked to `devices` and `app_users`)
  - Includes: `sender_info` (JSON/Text), `receiver_info` (JSON/Text), `waybill`, `package_dimensions`
- **tracking_events**: Delivery tracking timeline (linked to `orders`)
  - Includes: `package_id`, `date`, `location`, `description`
- **es_system__auth_user**: Internal Auth system table

## Pages
- `index.html`: Landing page with device catalog and tracking search (Modern Design)
- `tracking.html`: Order tracking results page (Live updates)
- `admin.html`: Admin panel (requires login) for managing:
  - Orders
  - Devices
  - Users (Role management, Order linking)
  - Assets (File upload/management)

## API Endpoints
- **Public**:
  - `GET /api/public/devices`
  - `POST /api/public/order-access`
- **Protected (Admin/User)**:
  - `POST /api/users/sync` - Sync user on login
  - `POST /api/users/link-order` - Link order to user
- **Protected (Admin Only)**:
  - `GET /api/users` - List users
  - `PUT /api/users/:id/role` - Update role
  - `POST /api/assets/upload` - Upload file
  - `GET /api/assets` - List files
  - `DELETE /api/assets/:id` - Delete file
  - `GET/POST /api/devices` - Manage devices
  - `GET/POST/PUT /api/orders` - Manage orders
  - `POST /api/orders/:id/events` - Add tracking event

## Assets
- Stored in R2 bucket `assets`
- Managed via Admin Panel > Assets

## Design System
- **Theme**: Modern Apple Education Store (Minimalist, Premium)
- **Typography**: Inter (Large headings, tight tracking)
- **Colors**: White, Soft Gray (#f5f5f7), Apple Blue (#0071e3)
- **Animations**: Fade-in up, smooth transitions, glassmorphism header

## User Management
- **Sync**: Users are synced from Auth to `app_users` on login.
- **Roles**: `admin`, `database_admin`, `user`.
- **Access Control**:
  - Admin Panel: Accessible by `admin` and `database_admin`.
  - Tracking Page: Public access via Order Number/Email.
  - **Pre-Authorization**: The system now supports pre-authorizing admins by email. If a user with a matching email exists in `app_users` (even without `auth_id`), the system will link the account on first login.
- Fixed `[EdgeSpark] baseUrl is required` runtime error by renaming `ns` to `createEdgeSpark` in `js/edgespark-client.js` to avoid export ambiguity.
- **Footer Positioning**: Added `margin-top: auto` to `.footer` class in `css/style.css` to ensure the footer stays at the bottom of the page container (`.page-wrapper`) even when content is short. This works in conjunction with the existing flex column layout of the wrapper.
