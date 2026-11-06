-- CreateTable
CREATE TABLE "candidate_menus" (
    "id" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "price" INTEGER,
    "priceBasis" VARCHAR(30) NOT NULL,
    "position" SMALLINT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_menus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "candidate_menus_candidateId_position_key" ON "candidate_menus"("candidateId", "position");

-- AddForeignKey
ALTER TABLE "candidate_menus" ADD CONSTRAINT "candidate_menus_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "place_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "candidate_menus"
ADD CONSTRAINT "candidate_menus_price_check"
CHECK (
  "price" IS NULL
  OR "price" BETWEEN 0 AND 10000000
);

ALTER TABLE "candidate_menus"
ADD CONSTRAINT "candidate_menus_position_check"
CHECK ("position" BETWEEN 0 AND 2);

ALTER TABLE "candidate_menus"
ADD CONSTRAINT "candidate_menus_name_check"
CHECK (char_length(btrim("name")) > 0);

ALTER TABLE "candidate_menus"
ADD CONSTRAINT "candidate_menus_price_basis_check"
CHECK (char_length(btrim("priceBasis")) > 0);