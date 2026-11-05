CREATE TYPE "public"."conversation_mode" AS ENUM('ai', 'human');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('open', 'waiting', 'closed');--> statement-breakpoint
CREATE TYPE "public"."courier_status" AS ENUM('available', 'busy', 'offline');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('awaiting_courier', 'assigned', 'out_for_delivery', 'delivered', 'problem', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."integration_provider" AS ENUM('whatsapp_cloud', 'mercadopago');--> statement-breakpoint
CREATE TYPE "public"."integration_status" AS ENUM('connected', 'error', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('inbound', 'outbound', 'internal');--> statement-breakpoint
CREATE TYPE "public"."message_sender" AS ENUM('customer', 'user', 'ai', 'system');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('received', 'pending', 'sent', 'delivered', 'read', 'failed');--> statement-breakpoint
CREATE TYPE "public"."message_type" AS ENUM('text', 'image', 'document', 'audio', 'video', 'location', 'template', 'other');--> statement-breakpoint
CREATE TYPE "public"."payment_tx_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled', 'refunded', 'expired');--> statement-breakpoint
ALTER TYPE "public"."order_event_type" ADD VALUE 'courier_assigned';--> statement-breakpoint
ALTER TYPE "public"."order_event_type" ADD VALUE 'delivery_problem';--> statement-breakpoint
ALTER TYPE "public"."order_event_type" ADD VALUE 'payment_updated';--> statement-breakpoint
CREATE TABLE "ai_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"settings" jsonb NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid,
	"purpose" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"customer_id" uuid,
	"contact_id" text NOT NULL,
	"contact_name" text,
	"status" "conversation_status" DEFAULT 'open' NOT NULL,
	"mode" "conversation_mode" DEFAULT 'ai' NOT NULL,
	"assigned_user_id" uuid,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"last_message_at" timestamp with time zone,
	"last_inbound_at" timestamp with time zone,
	"last_message_preview" text,
	"handoff_reason" text,
	"handoff_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"ai_draft" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "conversations_tenant_contact_key" UNIQUE("tenant_id","channel","contact_id")
);
--> statement-breakpoint
CREATE TABLE "couriers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"user_id" uuid,
	"status" "courier_status" DEFAULT 'available' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "couriers_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"courier_id" uuid,
	"zone_id" uuid,
	"zone_name" text,
	"status" "delivery_status" DEFAULT 'awaiting_courier' NOT NULL,
	"problem_reason" text,
	"assigned_at" timestamp with time zone,
	"dispatched_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"problem_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deliveries_order_key" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "delivery_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"fee_cents" integer NOT NULL,
	"min_order_cents" integer,
	"eta_minutes" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_zones_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "delivery_zones_fee_non_negative" CHECK ("delivery_zones"."fee_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"status" "integration_status" DEFAULT 'connected' NOT NULL,
	"external_id" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secrets" text NOT NULL,
	"last_error" text,
	"last_checked_at" timestamp with time zone,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integrations_tenant_provider_key" UNIQUE("tenant_id","provider")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"direction" "message_direction" NOT NULL,
	"sender" "message_sender" NOT NULL,
	"sender_user_id" uuid,
	"sender_name" text,
	"type" "message_type" DEFAULT 'text' NOT NULL,
	"body" text,
	"media_id" text,
	"media_url" text,
	"media_mime" text,
	"template_name" text,
	"external_id" text,
	"status" "message_status" NOT NULL,
	"error" text,
	"status_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"provider_payment_id" text NOT NULL,
	"method" text NOT NULL,
	"status" "payment_tx_status" NOT NULL,
	"amount_cents" integer NOT NULL,
	"refunded_cents" integer DEFAULT 0 NOT NULL,
	"qr_code" text,
	"qr_code_base64" text,
	"ticket_url" text,
	"expires_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"status_detail" text,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quick_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"tenant_id" uuid,
	"signature_valid" boolean NOT NULL,
	"payload" jsonb NOT NULL,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_customer_id_customers_tenant_id_id_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "couriers" ADD CONSTRAINT "couriers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "couriers" ADD CONSTRAINT "couriers_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_tenant_id_order_id_orders_tenant_id_id_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_tenant_id_courier_id_couriers_tenant_id_id_fk" FOREIGN KEY ("tenant_id","courier_id") REFERENCES "public"."couriers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_zones" ADD CONSTRAINT "delivery_zones_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_conversation_id_conversations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_order_id_orders_tenant_id_id_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_replies" ADD CONSTRAINT "quick_replies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_tenant_created_idx" ON "ai_usage" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "conversations_tenant_last_idx" ON "conversations" USING btree ("tenant_id","last_message_at");--> statement-breakpoint
CREATE INDEX "couriers_branch_idx" ON "couriers" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "deliveries_branch_status_idx" ON "deliveries" USING btree ("branch_id","status");--> statement-breakpoint
CREATE INDEX "deliveries_courier_idx" ON "deliveries" USING btree ("courier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_zones_branch_name_key" ON "delivery_zones" USING btree ("branch_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_provider_external_key" ON "integrations" USING btree ("provider","external_id") WHERE "integrations"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "jobs_queue_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_key" ON "jobs" USING btree ("dedupe_key") WHERE "jobs"."dedupe_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_external_key" ON "messages" USING btree ("external_id") WHERE "messages"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_external_key" ON "payments" USING btree ("provider","provider_payment_id");--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "quick_replies_tenant_idx" ON "quick_replies" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "webhook_events_received_idx" ON "webhook_events" USING btree ("received_at");