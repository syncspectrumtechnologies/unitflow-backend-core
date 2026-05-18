const router = require("express").Router();

const auth = require("../middlewares/authMiddleware");
const perm = require("../middlewares/permissionMiddleware");

const c = require("../controllers/permissionViewController");

router.use(auth);

router.get("/", perm(["admin.view.permissions"]), c.getPermissions);

module.exports = router;
