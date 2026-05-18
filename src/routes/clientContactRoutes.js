const express = require("express");
const router = express.Router({ mergeParams: true });

const authMiddleware = require("../middlewares/authMiddleware");
const permissionMiddleware = require("../middlewares/permissionMiddleware");

const clientContactController = require("../controllers/clientContactController");

router.use(authMiddleware);

// GET /clients/:clientId/contacts
router.get(
  "/:clientId/contacts",
  permissionMiddleware(["clients.view"]),
  clientContactController.getContactsByClient
);

// POST /clients/:clientId/contacts
router.post(
  "/:clientId/contacts",
  permissionMiddleware(["clients.update"]),
  clientContactController.createContact
);

// PUT /clients/:clientId/contacts/:contactId
router.put(
  "/:clientId/contacts/:contactId",
  permissionMiddleware(["clients.update"]),
  clientContactController.updateContact
);

// DELETE /clients/:clientId/contacts/:contactId
router.delete(
  "/:clientId/contacts/:contactId",
  permissionMiddleware(["clients.update"]),
  clientContactController.deleteContact
);

module.exports = router;
