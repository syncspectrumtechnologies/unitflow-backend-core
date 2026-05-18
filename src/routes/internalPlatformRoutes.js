const express = require('express');
const platformInternalAuthMiddleware = require('../middlewares/platformInternalAuthMiddleware');
const controller = require('../controllers/internalPlatformController');

const router = express.Router();

router.use(platformInternalAuthMiddleware);
router.post('/runtime/authenticate', controller.authenticateRuntimeUser);
router.post('/tenants/provision', controller.provisionTenant);
router.put('/tenants/:tenantId/status', controller.updateTenantStatus);
router.put('/tenants/:tenantId/config', controller.syncTenantConfig);
router.get('/tenants/:tenantId', controller.getTenantSnapshot);

module.exports = router;
