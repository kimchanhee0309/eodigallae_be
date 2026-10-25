BEGIN;
-- CreateTable
CREATE TABLE "place_candidates" (
    "id" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "address" VARCHAR(200) NOT NULL,
    "mapUrl" VARCHAR(2000),
    "memo" VARCHAR(300) NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "place_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "place_candidates_roomId_createdAt_id_idx" ON "place_candidates"("roomId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "place_candidates_createdById_idx" ON "place_candidates"("createdById");

-- AddForeignKey
ALTER TABLE "place_candidates" ADD CONSTRAINT "place_candidates_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "place_candidates" ADD CONSTRAINT "place_candidates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;