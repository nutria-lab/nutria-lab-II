-- CreateTable
CREATE TABLE "shopping_item_checks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "checked" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shopping_item_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shopping_item_checks_userId_planId_itemKey_key" ON "shopping_item_checks"("userId", "planId", "itemKey");

-- CreateIndex
CREATE INDEX "shopping_item_checks_planId_idx" ON "shopping_item_checks"("planId");

-- AddForeignKey
ALTER TABLE "shopping_item_checks" ADD CONSTRAINT "shopping_item_checks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopping_item_checks" ADD CONSTRAINT "shopping_item_checks_planId_fkey" FOREIGN KEY ("planId") REFERENCES "meal_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
