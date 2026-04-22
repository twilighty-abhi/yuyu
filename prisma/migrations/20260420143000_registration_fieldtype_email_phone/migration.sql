-- Reconcile migration history with existing database enum variants.
-- These values already exist in some dev DBs; IF NOT EXISTS keeps it safe.

ALTER TYPE "RegistrationFieldType" ADD VALUE IF NOT EXISTS 'EMAIL';
ALTER TYPE "RegistrationFieldType" ADD VALUE IF NOT EXISTS 'PHONE';

