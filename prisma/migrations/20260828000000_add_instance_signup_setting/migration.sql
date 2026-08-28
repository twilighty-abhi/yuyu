-- Instance-wide settings are deliberately a singleton, addressed by a fixed
-- application-owned ID. No seed row is needed: missing means the safe default
-- of allowing registrations, preserving existing installations' behaviour.
CREATE TABLE "InstanceSetting" (
    "id" TEXT NOT NULL,
    "allowNewUserSignups" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstanceSetting_pkey" PRIMARY KEY ("id")
);
