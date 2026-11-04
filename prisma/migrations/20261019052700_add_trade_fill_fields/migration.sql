-- AlterTable
ALTER TABLE "TradeHistory" ADD COLUMN "orderId" TEXT;
ALTER TABLE "TradeHistory" ADD COLUMN "filledAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "TradeHistory_orderId_key" ON "TradeHistory"("orderId");
