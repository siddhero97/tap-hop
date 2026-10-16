# TabHop Roadmap & Architectural TODOs

## Future Architecture
- [ ] **Extract Payment Microservice (`services/payments`)**: Extract the payments domain (`src/payments/`, PayPal gateway adapters, and PayPal webhook verification/ingestion) out of `services/api` into its own standalone microservice at a later date.
- [ ] **Authentication & Account Management (`login`, `logout`, `register`)**: Replace the placeholder `authMiddleware` (`src/middleware/auth.ts`) with full authentication for merchants, staff, and/or patrons.
