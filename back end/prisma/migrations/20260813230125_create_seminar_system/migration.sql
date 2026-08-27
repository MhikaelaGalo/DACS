-- CreateEnum
CREATE TYPE "CertificateRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "seminar_modules" (
    "id" TEXT NOT NULL,
    "module_number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "passing_score" INTEGER NOT NULL,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seminar_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seminar_videos" (
    "id" TEXT NOT NULL,
    "module_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "video_url" TEXT NOT NULL,
    "description" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seminar_videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seminar_questions" (
    "id" TEXT NOT NULL,
    "module_id" TEXT NOT NULL,
    "question_text" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 1,
    "display_order" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seminar_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seminar_choices" (
    "id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "choice_text" TEXT NOT NULL,
    "is_correct" BOOLEAN NOT NULL DEFAULT false,
    "display_order" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seminar_choices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seminar_enrollments" (
    "id" TEXT NOT NULL,
    "customer_profile_id" TEXT NOT NULL,
    "module_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "last_accessed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seminar_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seminar_progress" (
    "id" TEXT NOT NULL,
    "enrollment_id" TEXT NOT NULL,
    "video_id" TEXT NOT NULL,
    "progress_percent" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seminar_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_attempts" (
    "id" TEXT NOT NULL,
    "enrollment_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "total_score" INTEGER NOT NULL,
    "percentage" DECIMAL(5,2) NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "answers" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quiz_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificate_requests" (
    "id" TEXT NOT NULL,
    "customer_profile_id" TEXT NOT NULL,
    "status" "CertificateRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by_user_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_notes" TEXT,
    "certificate_number" TEXT,
    "certificate_issued_at" TIMESTAMP(3),

    CONSTRAINT "certificate_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "seminar_modules_module_number_key" ON "seminar_modules"("module_number");

-- CreateIndex
CREATE INDEX "seminar_modules_is_published_idx" ON "seminar_modules"("is_published");

-- CreateIndex
CREATE INDEX "seminar_videos_module_id_display_order_idx" ON "seminar_videos"("module_id", "display_order");

-- CreateIndex
CREATE INDEX "seminar_questions_module_id_display_order_idx" ON "seminar_questions"("module_id", "display_order");

-- CreateIndex
CREATE INDEX "seminar_choices_question_id_idx" ON "seminar_choices"("question_id");

-- CreateIndex
CREATE INDEX "seminar_enrollments_customer_profile_id_idx" ON "seminar_enrollments"("customer_profile_id");

-- CreateIndex
CREATE INDEX "seminar_enrollments_module_id_idx" ON "seminar_enrollments"("module_id");

-- CreateIndex
CREATE INDEX "seminar_enrollments_completed_at_idx" ON "seminar_enrollments"("completed_at");

-- CreateIndex
CREATE UNIQUE INDEX "seminar_enrollments_customer_profile_id_module_id_key" ON "seminar_enrollments"("customer_profile_id", "module_id");

-- CreateIndex
CREATE INDEX "seminar_progress_video_id_idx" ON "seminar_progress"("video_id");

-- CreateIndex
CREATE UNIQUE INDEX "seminar_progress_enrollment_id_video_id_key" ON "seminar_progress"("enrollment_id", "video_id");

-- CreateIndex
CREATE INDEX "quiz_attempts_enrollment_id_idx" ON "quiz_attempts"("enrollment_id");

-- CreateIndex
CREATE INDEX "quiz_attempts_passed_idx" ON "quiz_attempts"("passed");

-- CreateIndex
CREATE UNIQUE INDEX "certificate_requests_certificate_number_key" ON "certificate_requests"("certificate_number");

-- CreateIndex
CREATE INDEX "certificate_requests_customer_profile_id_idx" ON "certificate_requests"("customer_profile_id");

-- CreateIndex
CREATE INDEX "certificate_requests_status_idx" ON "certificate_requests"("status");

-- AddForeignKey
ALTER TABLE "seminar_videos" ADD CONSTRAINT "seminar_videos_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "seminar_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seminar_questions" ADD CONSTRAINT "seminar_questions_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "seminar_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seminar_choices" ADD CONSTRAINT "seminar_choices_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "seminar_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seminar_enrollments" ADD CONSTRAINT "seminar_enrollments_customer_profile_id_fkey" FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seminar_enrollments" ADD CONSTRAINT "seminar_enrollments_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "seminar_modules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seminar_progress" ADD CONSTRAINT "seminar_progress_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "seminar_enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seminar_progress" ADD CONSTRAINT "seminar_progress_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "seminar_videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "seminar_enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificate_requests" ADD CONSTRAINT "certificate_requests_customer_profile_id_fkey" FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificate_requests" ADD CONSTRAINT "certificate_requests_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
