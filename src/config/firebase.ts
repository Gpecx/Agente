import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Initializes the Firebase Admin SDK using environment variables.
 * Uses a singleton pattern to avoid multiple initializations.
 */
export const initFirebase = (): admin.app.App => {
  if (admin.apps.length > 0) {
    return admin.app(); // Returns the default app
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  // Handle newline characters in the private key when loaded from an environment variable
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    console.warn('⚠️ Firebase Admin initialization warning: Missing credentials in environment variables.');
    // In environments like GCP, it might initialize successfully without explicit credentials
    return admin.initializeApp();
  }

  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
};

// Export the initialized app instance for direct usage if needed
export const firebaseApp = initFirebase();
