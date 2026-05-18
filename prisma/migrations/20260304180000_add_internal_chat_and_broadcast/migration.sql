-- CreateEnum
CREATE TYPE "ConversationType" AS ENUM ('DIRECT');

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "type" "ConversationType" NOT NULL DEFAULT 'DIRECT',
    "direct_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationMember" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "last_read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateEnum
CREATE TYPE "BroadcastTargetType" AS ENUM ('ALL', 'ROLES', 'USERS');

-- CreateTable
CREATE TABLE "BroadcastMessage" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "target_type" "BroadcastTargetType" NOT NULL,
    "target_role_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "target_user_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BroadcastMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BroadcastRecipient" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "broadcast_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BroadcastRecipient_pkey" PRIMARY KEY ("id")
);

-- Unique constraints
CREATE UNIQUE INDEX "Conversation_company_id_direct_key_key" ON "Conversation"("company_id", "direct_key");
CREATE UNIQUE INDEX "ConversationMember_conversation_id_user_id_key" ON "ConversationMember"("conversation_id", "user_id");
CREATE UNIQUE INDEX "BroadcastRecipient_broadcast_id_user_id_key" ON "BroadcastRecipient"("broadcast_id", "user_id");

-- Indexes
CREATE INDEX "Conversation_company_id_created_at_idx" ON "Conversation"("company_id", "created_at");
CREATE INDEX "Conversation_company_id_updated_at_idx" ON "Conversation"("company_id", "updated_at");
CREATE INDEX "ConversationMember_company_id_user_id_idx" ON "ConversationMember"("company_id", "user_id");
CREATE INDEX "ConversationMember_company_id_conversation_id_idx" ON "ConversationMember"("company_id", "conversation_id");
CREATE INDEX "ChatMessage_company_id_created_at_idx" ON "ChatMessage"("company_id", "created_at");
CREATE INDEX "ChatMessage_conversation_id_created_at_idx" ON "ChatMessage"("conversation_id", "created_at");
CREATE INDEX "BroadcastMessage_company_id_created_at_idx" ON "BroadcastMessage"("company_id", "created_at");
CREATE INDEX "BroadcastRecipient_company_id_created_at_idx" ON "BroadcastRecipient"("company_id", "created_at");
CREATE INDEX "BroadcastRecipient_user_id_seen_at_idx" ON "BroadcastRecipient"("user_id", "seen_at");
CREATE INDEX "BroadcastRecipient_company_id_broadcast_id_idx" ON "BroadcastRecipient"("company_id", "broadcast_id");

-- Foreign keys
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConversationMember" ADD CONSTRAINT "ConversationMember_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConversationMember" ADD CONSTRAINT "ConversationMember_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConversationMember" ADD CONSTRAINT "ConversationMember_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BroadcastMessage" ADD CONSTRAINT "BroadcastMessage_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BroadcastMessage" ADD CONSTRAINT "BroadcastMessage_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BroadcastRecipient" ADD CONSTRAINT "BroadcastRecipient_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BroadcastRecipient" ADD CONSTRAINT "BroadcastRecipient_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "BroadcastMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BroadcastRecipient" ADD CONSTRAINT "BroadcastRecipient_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
