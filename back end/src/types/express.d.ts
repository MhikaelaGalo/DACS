import type { DecodedIdToken } from "firebase-admin/auth";

import type { AccountStatus, UserRole } from "../../generated/prisma/client";

declare global {
  namespace Express {
    interface Request {
      firebaseUser?: DecodedIdToken;
      dacsUser?: {
        id: string;
        /* Null only for pre-authorized rows, which can never reach
           loadDacsUser (it looks users up BY firebaseUid). */
        firebaseUid: string | null;
        email: string;
        role: UserRole;
        status: AccountStatus;
        lastLoginAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
      };
    }
  }
}

export {};
