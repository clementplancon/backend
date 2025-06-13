-- CreateTable
CREATE TABLE "Clock" (
    "id" SERIAL NOT NULL,
    "tournamentId" INTEGER NOT NULL,
    "currentLevel" INTEGER NOT NULL,
    "levelStartAt" TIMESTAMP(3) NOT NULL,
    "elapsed" INTEGER NOT NULL,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Clock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Clock_tournamentId_key" ON "Clock"("tournamentId");

-- AddForeignKey
ALTER TABLE "Clock" ADD CONSTRAINT "Clock_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
