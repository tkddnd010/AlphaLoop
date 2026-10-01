-- CreateTable
CREATE TABLE "StrategyLog" (
    "id" SERIAL NOT NULL,
    "symbol" TEXT NOT NULL,
    "dartId" TEXT,
    "llmScore" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategyLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeHistory" (
    "id" SERIAL NOT NULL,
    "symbol" TEXT NOT NULL,
    "orderType" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "orderedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "strategyId" INTEGER,

    CONSTRAINT "TradeHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrorLog" (
    "id" SERIAL NOT NULL,
    "module" TEXT NOT NULL,
    "errorCode" TEXT,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErrorLog_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "TradeHistory" ADD CONSTRAINT "TradeHistory_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "StrategyLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
