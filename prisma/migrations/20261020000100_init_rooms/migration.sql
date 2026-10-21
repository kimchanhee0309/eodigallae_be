BEGIN;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RoomStatus" AS ENUM ('OPEN', 'FINALIZED');

-- CreateEnum
CREATE TYPE "ParticipantRole" AS ENUM ('HOST', 'MEMBER');

-- CreateTable
CREATE TABLE "rooms" (
    "id" UUID NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "description" VARCHAR(300) NOT NULL DEFAULT '',
    "status" "RoomStatus" NOT NULL DEFAULT 'OPEN',
    "inviteTokenHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participants" (
    "id" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "nickname" VARCHAR(12) NOT NULL,
    "role" "ParticipantRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participant_sessions" (
    "id" UUID NOT NULL,
    "participantId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "participant_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rooms_inviteTokenHash_key" ON "rooms"("inviteTokenHash");

-- CreateIndex
CREATE INDEX "participants_roomId_idx" ON "participants"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX "participant_sessions_tokenHash_key" ON "participant_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "participant_sessions_participantId_idx" ON "participant_sessions"("participantId");

-- CreateIndex
CREATE INDEX "participant_sessions_expiresAt_idx" ON "participant_sessions"("expiresAt");

-- AddForeignKey
ALTER TABLE "participants" ADD CONSTRAINT "participants_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_sessions" ADD CONSTRAINT "participant_sessions_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "participants_one_host_per_room"
ON "participants" ("roomId")
WHERE "role" = 'HOST';

COMMIT;