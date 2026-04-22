-- CreateTable
CREATE TABLE "OrganisationInvite" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL DEFAULT 'MEMBER',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "usedByUserId" TEXT,

    CONSTRAINT "OrganisationInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganisationInvite_token_key" ON "OrganisationInvite"("token");

-- CreateIndex
CREATE INDEX "OrganisationInvite_organisationId_idx" ON "OrganisationInvite"("organisationId");

-- CreateIndex
CREATE INDEX "OrganisationInvite_organisationId_createdAt_idx" ON "OrganisationInvite"("organisationId", "createdAt");

-- CreateIndex
CREATE INDEX "OrganisationInvite_usedAt_idx" ON "OrganisationInvite"("usedAt");

-- AddForeignKey
ALTER TABLE "OrganisationInvite" ADD CONSTRAINT "OrganisationInvite_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationInvite" ADD CONSTRAINT "OrganisationInvite_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationInvite" ADD CONSTRAINT "OrganisationInvite_usedByUserId_fkey" FOREIGN KEY ("usedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
