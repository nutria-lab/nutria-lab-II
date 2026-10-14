-- NUT-85: tablas de telemetría KPI (aditiva). Sin FK, sin PII, sin cambios a columnas de negocio.
-- Los CHECK no se expresan en Prisma: viven sólo en esta migración.

-- CreateTable
CREATE TABLE "kpi_http_event" (
    "id" UUID NOT NULL,
    "environment" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3),
    "duration_ms" DOUBLE PRECISION,
    "http_status" SMALLINT,
    "outcome" TEXT NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kpi_http_event_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kpi_http_event_environment_check" CHECK ("environment" IN ('dev', 'qa', 'prod')),
    CONSTRAINT "kpi_http_event_outcome_check" CHECK ("outcome" IN ('pending', 'success', 'client_error', 'server_error', 'network_error', 'timeout', 'other')),
    CONSTRAINT "kpi_http_event_operation_length_check" CHECK (char_length("operation") BETWEEN 1 AND 200),
    CONSTRAINT "kpi_http_event_duration_check" CHECK ("duration_ms" IS NULL OR ("duration_ms" >= 0 AND "duration_ms" < 'Infinity'::double precision)),
    CONSTRAINT "kpi_http_event_http_status_range_check" CHECK ("http_status" IS NULL OR "http_status" BETWEEN 100 AND 599),
    CONSTRAINT "kpi_http_event_finished_after_started_check" CHECK ("finished_at" IS NULL OR "finished_at" >= "started_at"),
    CONSTRAINT "kpi_http_event_lifecycle_check" CHECK (
        ("outcome" = 'pending' AND "finished_at" IS NULL AND "duration_ms" IS NULL AND "http_status" IS NULL)
        OR ("outcome" <> 'pending' AND "finished_at" IS NOT NULL AND "duration_ms" IS NOT NULL)
    ),
    CONSTRAINT "kpi_http_event_status_by_outcome_check" CHECK (
        ("outcome" <> 'pending' OR "http_status" IS NULL)
        AND ("outcome" <> 'success' OR ("http_status" IS NOT NULL AND "http_status" BETWEEN 200 AND 299))
        AND ("outcome" <> 'client_error' OR ("http_status" IS NOT NULL AND "http_status" BETWEEN 400 AND 499))
        AND ("outcome" <> 'server_error' OR ("http_status" IS NOT NULL AND "http_status" BETWEEN 500 AND 599))
    )
);

-- CreateTable
CREATE TABLE "kpi_dependency_event" (
    "id" UUID NOT NULL,
    "environment" TEXT NOT NULL,
    "operation_id" UUID NOT NULL,
    "dependency" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3),
    "duration_ms" DOUBLE PRECISION,
    "outcome" TEXT NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kpi_dependency_event_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kpi_dependency_event_environment_check" CHECK ("environment" IN ('dev', 'qa', 'prod')),
    CONSTRAINT "kpi_dependency_event_outcome_check" CHECK ("outcome" IN ('pending', 'success', 'error', 'timeout')),
    CONSTRAINT "kpi_dependency_event_dependency_length_check" CHECK (char_length("dependency") BETWEEN 1 AND 64),
    CONSTRAINT "kpi_dependency_event_attempt_check" CHECK ("attempt" >= 1),
    CONSTRAINT "kpi_dependency_event_duration_check" CHECK ("duration_ms" IS NULL OR ("duration_ms" >= 0 AND "duration_ms" < 'Infinity'::double precision)),
    CONSTRAINT "kpi_dependency_event_finished_after_started_check" CHECK ("finished_at" IS NULL OR "finished_at" >= "started_at"),
    CONSTRAINT "kpi_dependency_event_lifecycle_check" CHECK (
        ("outcome" = 'pending' AND "finished_at" IS NULL AND "duration_ms" IS NULL)
        OR ("outcome" <> 'pending' AND "finished_at" IS NOT NULL AND "duration_ms" IS NOT NULL)
    )
);

-- CreateTable
CREATE TABLE "kpi_health_sample" (
    "id" UUID NOT NULL,
    "environment" TEXT NOT NULL,
    "scheduled_for" TIMESTAMPTZ(3) NOT NULL,
    "measured_at" TIMESTAMPTZ(3) NOT NULL,
    "api_ok" BOOLEAN,
    "database_ok" BOOLEAN,
    "outcome" TEXT NOT NULL,
    "reason" TEXT,

    CONSTRAINT "kpi_health_sample_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kpi_health_sample_environment_check" CHECK ("environment" IN ('dev', 'qa', 'prod')),
    CONSTRAINT "kpi_health_sample_outcome_check" CHECK ("outcome" IN ('healthy', 'unhealthy', 'unknown')),
    CONSTRAINT "kpi_health_sample_healthy_check" CHECK ("outcome" <> 'healthy' OR ("api_ok" IS TRUE AND "database_ok" IS TRUE)),
    CONSTRAINT "kpi_health_sample_unhealthy_check" CHECK ("outcome" <> 'unhealthy' OR "api_ok" IS FALSE OR "database_ok" IS FALSE),
    CONSTRAINT "kpi_health_sample_unknown_check" CHECK (
        "outcome" <> 'unknown'
        OR (("api_ok" IS NULL OR "database_ok" IS NULL) AND "api_ok" IS NOT FALSE AND "database_ok" IS NOT FALSE)
    ),
    CONSTRAINT "kpi_health_sample_scheduled_alignment_check" CHECK (mod(extract(epoch FROM "scheduled_for")::numeric, 1800) = 0),
    CONSTRAINT "kpi_health_sample_measured_after_scheduled_check" CHECK ("measured_at" >= "scheduled_for")
);

-- CreateTable
CREATE TABLE "kpi_snapshot" (
    "id" UUID NOT NULL,
    "environment" TEXT NOT NULL,
    "report_date" DATE NOT NULL,
    "window_start" TIMESTAMPTZ(3) NOT NULL,
    "window_end" TIMESTAMPTZ(3) NOT NULL,
    "snapshot_kind" TEXT NOT NULL,
    "kpi_id" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "quality" TEXT NOT NULL,
    "reason" TEXT,
    "sample_count" BIGINT NOT NULL,
    "measured_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "kpi_snapshot_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kpi_snapshot_environment_check" CHECK ("environment" IN ('dev', 'qa', 'prod')),
    CONSTRAINT "kpi_snapshot_snapshot_kind_check" CHECK ("snapshot_kind" IN ('preview', 'final')),
    CONSTRAINT "kpi_snapshot_kpi_id_check" CHECK ("kpi_id" IN ('operations_count', 'error_rate', 'latency_p95_ms', 'health_status', 'last_success_age_seconds', 'timeout_rate', 'dependency_error_rate', 'availability_rate')),
    CONSTRAINT "kpi_snapshot_quality_check" CHECK ("quality" IN ('observed', 'unavailable')),
    CONSTRAINT "kpi_snapshot_sample_count_check" CHECK ("sample_count" >= 0),
    CONSTRAINT "kpi_snapshot_window_check" CHECK ("window_start" < "window_end"),
    CONSTRAINT "kpi_snapshot_observed_value_check" CHECK (
        "quality" <> 'observed'
        OR ("value" IS NOT NULL AND "value" >= 0 AND "value" < 'Infinity'::double precision)
    ),
    CONSTRAINT "kpi_snapshot_unavailable_value_check" CHECK (
        "quality" <> 'unavailable'
        OR ("value" IS NULL AND "reason" IS NOT NULL AND char_length(btrim("reason")) > 0)
    ),
    CONSTRAINT "kpi_snapshot_percentage_range_check" CHECK (
        "kpi_id" NOT IN ('error_rate', 'timeout_rate', 'dependency_error_rate', 'availability_rate')
        OR "value" IS NULL
        OR "value" <= 100
    ),
    CONSTRAINT "kpi_snapshot_health_value_check" CHECK ("kpi_id" <> 'health_status' OR "value" IS NULL OR "value" IN (0, 1))
);

-- CreateTable
CREATE TABLE "kpi_publication" (
    "run_id" UUID NOT NULL,
    "environment" TEXT NOT NULL,
    "report_date" DATE NOT NULL,
    "window_start" TIMESTAMPTZ(3) NOT NULL,
    "window_end" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL,
    "frozen_batch" JSONB,
    "payload_sha256" TEXT,
    "source_commit" TEXT NOT NULL,
    "retry_chain_id" UUID NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),

    CONSTRAINT "kpi_publication_pkey" PRIMARY KEY ("run_id"),
    CONSTRAINT "kpi_publication_environment_check" CHECK ("environment" IN ('dev', 'qa', 'prod')),
    CONSTRAINT "kpi_publication_status_check" CHECK ("status" IN ('preparing', 'frozen', 'accepted', 'delivered', 'failed')),
    CONSTRAINT "kpi_publication_attempt_count_check" CHECK ("attempt_count" BETWEEN 0 AND 3),
    CONSTRAINT "kpi_publication_window_check" CHECK ("window_start" < "window_end"),
    CONSTRAINT "kpi_publication_payload_sha256_format_check" CHECK ("payload_sha256" IS NULL OR "payload_sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "kpi_publication_batch_hash_pair_check" CHECK (("frozen_batch" IS NULL) = ("payload_sha256" IS NULL)),
    CONSTRAINT "kpi_publication_batch_required_check" CHECK (
        "status" NOT IN ('frozen', 'accepted', 'delivered')
        OR ("frozen_batch" IS NOT NULL AND "payload_sha256" IS NOT NULL)
    ),
    CONSTRAINT "kpi_publication_accepted_at_required_check" CHECK ("status" NOT IN ('accepted', 'delivered') OR "accepted_at" IS NOT NULL),
    CONSTRAINT "kpi_publication_delivered_at_required_check" CHECK ("status" <> 'delivered' OR "delivered_at" IS NOT NULL)
);

-- CreateIndex
CREATE INDEX "kpi_http_event_environment_finished_at_idx" ON "kpi_http_event"("environment", "finished_at");

-- CreateIndex
CREATE INDEX "kpi_http_event_environment_outcome_finished_at_idx" ON "kpi_http_event"("environment", "outcome", "finished_at");

-- CreateIndex
CREATE INDEX "kpi_http_event_environment_started_at_idx" ON "kpi_http_event"("environment", "started_at");

-- CreateIndex
CREATE INDEX "kpi_dependency_event_environment_finished_at_idx" ON "kpi_dependency_event"("environment", "finished_at");

-- CreateIndex
CREATE INDEX "kpi_dependency_event_environment_outcome_finished_at_idx" ON "kpi_dependency_event"("environment", "outcome", "finished_at");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_dependency_event_attempt_key" ON "kpi_dependency_event"("environment", "operation_id", "dependency", "attempt");

-- CreateIndex
CREATE INDEX "kpi_health_sample_environment_measured_at_idx" ON "kpi_health_sample"("environment", "measured_at");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_health_sample_bucket_key" ON "kpi_health_sample"("environment", "scheduled_for");

-- CreateIndex
CREATE INDEX "kpi_snapshot_environment_report_date_snapshot_kind_idx" ON "kpi_snapshot"("environment", "report_date", "snapshot_kind");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_snapshot_cut_key" ON "kpi_snapshot"("environment", "report_date", "window_end", "snapshot_kind", "kpi_id");

-- CreateIndex
CREATE INDEX "kpi_publication_status_updated_at_idx" ON "kpi_publication"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_publication_day_key" ON "kpi_publication"("environment", "report_date");

-- CreateIndex: única modificación sobre tablas de negocio (sólo índices, sin CONCURRENTLY porque corre en transacción).
CREATE INDEX "meal_plans_createdAt_idx" ON "meal_plans"("createdAt");

-- CreateIndex
CREATE INDEX "recipes_createdAt_idx" ON "recipes"("createdAt");
