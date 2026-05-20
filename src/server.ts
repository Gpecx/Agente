import express, { Request, Response } from 'express';
import path from 'path';
import cors from 'cors';
import dotenv from 'dotenv';
import { initFirebase } from './config/firebase';
import webhookRoutes from './routes/webhook.routes';
import adminRoutes from './routes/admin.routes';

// Load environment variables from .env file
dotenv.config();

// Initialize Firebase Admin SDK
initFirebase();

const app = express();
const port = process.env.PORT || 3000;

// --- Middleware ---

// Enable CORS for all routes
app.use(cors());

// Parse incoming JSON payloads (critical for webhook processing)
// Increasing limit might be necessary depending on the expected webhook payload sizes
app.use(express.json({ limit: '5mb' })); 

// Serve static files from the 'public' directory
app.use(express.static('public'));

// --- Endpoints ---

/**
 * @route GET /health
 * @desc Health check endpoint to verify the server is running.
 */
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.use('/webhook', webhookRoutes);

// Mount the admin router under /api/admin
app.use('/api/admin', adminRoutes);

// --- Server Startup ---

app.listen(port, () => {
  console.log(`🚀 Webhook server is running on port ${port}`);
});
