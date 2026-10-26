BEGIN;
-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "finalizedAt" TIMESTAMPTZ(3),
ADD COLUMN     "finalizedCandidateId" UUID;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_id_finalizedCandidateId_fkey" FOREIGN KEY ("id", "finalizedCandidateId") REFERENCES "place_candidates"("roomId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT;