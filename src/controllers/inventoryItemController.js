exports.deprecated = async (req, res) => {
  return res.status(410).json({
    message:
      "Inventory Items have been replaced by Products + Inventory Movements. Use /products for catalog and /inventory/stock or /inventory/movements for inventory."
  });
};
