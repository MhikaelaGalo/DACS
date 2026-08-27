-- CreateEnum
CREATE TYPE "InquiryTicketStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'RESPONDED', 'CLOSED');

-- CreateTable
CREATE TABLE "inquiry_tickets" (
    "id" TEXT NOT NULL,
    "ticket_number" TEXT NOT NULL,
    "customer_profile_id" TEXT NOT NULL,
    "related_order_id" TEXT,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "category" TEXT,
    "priority" TEXT,
    "status" "InquiryTicketStatus" NOT NULL DEFAULT 'SUBMITTED',
    "assigned_to_user_id" TEXT,
    "assigned_at" TIMESTAMP(3),
    "under_review_at" TIMESTAMP(3),
    "responded_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "email_responded_by_user_id" TEXT,
    "email_responded_at" TIMESTAMP(3),
    "email_response_reference" TEXT,
    "email_response_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inquiry_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_status_history" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "from_status" "InquiryTicketStatus",
    "to_status" "InquiryTicketStatus" NOT NULL,
    "changed_by_user_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inquiry_tickets_ticket_number_key" ON "inquiry_tickets"("ticket_number");

-- CreateIndex
CREATE INDEX "inquiry_tickets_customer_profile_id_idx" ON "inquiry_tickets"("customer_profile_id");

-- CreateIndex
CREATE INDEX "inquiry_tickets_related_order_id_idx" ON "inquiry_tickets"("related_order_id");

-- CreateIndex
CREATE INDEX "inquiry_tickets_status_idx" ON "inquiry_tickets"("status");

-- CreateIndex
CREATE INDEX "inquiry_tickets_category_idx" ON "inquiry_tickets"("category");

-- CreateIndex
CREATE INDEX "inquiry_tickets_priority_idx" ON "inquiry_tickets"("priority");

-- CreateIndex
CREATE INDEX "inquiry_tickets_assigned_to_user_id_idx" ON "inquiry_tickets"("assigned_to_user_id");

-- CreateIndex
CREATE INDEX "inquiry_tickets_created_at_idx" ON "inquiry_tickets"("created_at");

-- CreateIndex
CREATE INDEX "ticket_status_history_ticket_id_created_at_idx" ON "ticket_status_history"("ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "ticket_status_history_changed_by_user_id_idx" ON "ticket_status_history"("changed_by_user_id");

-- AddForeignKey
ALTER TABLE "inquiry_tickets" ADD CONSTRAINT "inquiry_tickets_customer_profile_id_fkey" FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_tickets" ADD CONSTRAINT "inquiry_tickets_related_order_id_fkey" FOREIGN KEY ("related_order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_tickets" ADD CONSTRAINT "inquiry_tickets_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_tickets" ADD CONSTRAINT "inquiry_tickets_email_responded_by_user_id_fkey" FOREIGN KEY ("email_responded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_status_history" ADD CONSTRAINT "ticket_status_history_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "inquiry_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_status_history" ADD CONSTRAINT "ticket_status_history_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
