const express = require('express');
const platformInternalAuthMiddleware = require('../middlewares/platformInternalAuthMiddleware');
const controller = require('../controllers/internalPlatformController');

const router = express.Router();

router.use(platformInternalAuthMiddleware);
router.post('/runtime/authenticate', controller.authenticateRuntimeUser);
router.get('/tenants/:tenantId/users', controller.listTenantUsers);
router.post('/tenants/:tenantId/users', controller.createTenantUser);
router.get('/tenants/:tenantId/roles', controller.listTenantRoles);
router.post('/tenants/:tenantId/roles', controller.createTenantRole);
router.post('/tenants/:tenantId/users/:userId/roles', controller.assignTenantUserRole);
router.get('/tenants/:tenantId/permissions', controller.listTenantPermissions);
router.post('/tenants/:tenantId/roles/:roleId/permissions', controller.attachTenantRolePermissions);
router.post('/tenants/provision', controller.provisionTenant);
router.put('/tenants/:tenantId/status', controller.updateTenantStatus);
router.put('/tenants/:tenantId/config', controller.syncTenantConfig);
router.get('/tenants/:tenantId', controller.getTenantSnapshot);

module.exports = router;
