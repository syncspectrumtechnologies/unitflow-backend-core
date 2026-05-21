# UnitFlow Core API

This core runtime is based on the upgraded Babanamak ERP backend and is wired into the UnitFlow Platform API for tenant provisioning and runtime access control.

## Runtime Boundary

The Platform API remains the control plane for signup, verification, subscriptions, devices, seats, sessions, and tenant lifecycle. Core exposes internal Platform-only endpoints under:

- `POST /internal/platform/tenants/provision`
- `PUT /internal/platform/tenants/:tenantId/status`
- `PUT /internal/platform/tenants/:tenantId/config`
- `GET /internal/platform/tenants/:tenantId`
- `POST /internal/platform/runtime/authenticate`

Platform calls these endpoints with `PLATFORM_INTERNAL_API_KEY`. Platform-issued runtime JWTs are verified by Core using `PLATFORM_RUNTIME_JWT_SECRET`, then Core validates the runtime session back against Platform.

## Useful Commands

```bash
npm run prisma:generate
npm run prisma:migrate
npm start
```

## Azure Deployment Notes

- Set app settings in Azure App Service for `DATABASE_URL`, `JWT_SECRET`, `PLATFORM_INTERNAL_API_KEY`, `PLATFORM_RUNTIME_JWT_SECRET`, and `PLATFORM_API_BASE_URL`.
- Prisma client generation now runs during install, before `npm start`, and again at boot if the generated client is missing from the deployment artifact.
