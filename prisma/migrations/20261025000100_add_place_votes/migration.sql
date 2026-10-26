BEGIN;
-- CreateTable
CREATE TABLE "place_votes" (
    "roomId" UUID NOT NULL,
    "participantId" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "place_votes_pkey" PRIMARY KEY ("roomId","participantId")
);

-- CreateIndex
CREATE INDEX "place_votes_roomId_candidateId_idx" ON "place_votes"("roomId", "candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "participants_roomId_id_key" ON "participants"("roomId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "place_candidates_roomId_id_key" ON "place_candidates"("roomId", "id");

-- AddForeignKey
ALTER TABLE "place_votes" ADD CONSTRAINT "place_votes_roomId_participantId_fkey" FOREIGN KEY ("roomId", "participantId") REFERENCES "participants"("roomId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "place_votes" ADD CONSTRAINT "place_votes_roomId_candidateId_fkey" FOREIGN KEY ("roomId", "candidateId") REFERENCES "place_candidates"("roomId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;