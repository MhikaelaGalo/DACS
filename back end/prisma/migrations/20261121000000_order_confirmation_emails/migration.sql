CREATE TABLE "order_confirmation_emails" (
    "order_id" TEXT PRIMARY KEY REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "sender" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "next_attempt_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT
);

CREATE INDEX "order_confirmation_emails_next_attempt_at_idx"
    ON "order_confirmation_emails"("next_attempt_at");
