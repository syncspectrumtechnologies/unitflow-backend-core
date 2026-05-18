const prisma = require('../config/db');
const logActivity = require('../utils/activityLogger');

async function ensureClient(company_id, clientId) {
  const client = await prisma.client.findFirst({
    where: { id: clientId, company_id, is_active: true },
    select: { id: true, company_name: true }
  });
  if (!client) {
    const err = new Error('CLIENT_NOT_FOUND');
    err.statusCode = 404;
    throw err;
  }
  return client;
}

async function ensureCategory(company_id, category_id) {
  const category = await prisma.productCategory.findFirst({
    where: { id: category_id, company_id, is_active: true },
    select: { id: true, name: true }
  });
  if (!category) {
    const err = new Error('CATEGORY_NOT_FOUND');
    err.statusCode = 404;
    throw err;
  }
  return category;
}

exports.getClientCategories = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { clientId } = req.params;
    await ensureClient(company_id, clientId);

    const categories = await prisma.clientCategory.findMany({
      where: { company_id, client_id: clientId, is_active: true },
      orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
      include: {
        category: {
          select: { id: true, name: true, description: true, is_active: true }
        }
      }
    });

    return res.json(categories);
  } catch (err) {
    console.error('getClientCategories error:', err);
    return res.status(err.statusCode || 500).json({ message: err.message === 'CLIENT_NOT_FOUND' ? 'Client not found' : 'Internal server error' });
  }
};

exports.addClientCategory = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { clientId } = req.params;
    const { category_id } = req.body || {};

    if (!category_id) return res.status(400).json({ message: 'category_id is required' });

    await ensureClient(company_id, clientId);
    const category = await ensureCategory(company_id, category_id);

    const existing = await prisma.clientCategory.findFirst({
      where: { company_id, client_id: clientId, category_id }
    });

    let row;
    if (existing) {
      row = await prisma.clientCategory.update({
        where: { id: existing.id },
        data: { is_active: true }
      });
    } else {
      row = await prisma.clientCategory.create({
        data: { company_id, client_id: clientId, category_id, is_active: true }
      });
    }

    const payload = {
      ...row,
      category
    };

    await logActivity({
      company_id,
      user_id: req.user.id,
      action: 'CLIENT_CATEGORY_ADDED',
      entity_type: 'client_category',
      entity_id: row.id,
      new_value: payload
    });

    return res.status(201).json(payload);
  } catch (err) {
    console.error('addClientCategory error:', err);
    if (err.message === 'CLIENT_NOT_FOUND') return res.status(404).json({ message: 'Client not found' });
    if (err.message === 'CATEGORY_NOT_FOUND') return res.status(404).json({ message: 'Category not found' });
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.removeClientCategory = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { clientId, categoryId } = req.params;

    const existing = await prisma.clientCategory.findFirst({
      where: { company_id, client_id: clientId, category_id: categoryId, is_active: true },
      include: { category: { select: { id: true, name: true } } }
    });
    if (!existing) return res.status(404).json({ message: 'Client category mapping not found' });

    const updated = await prisma.clientCategory.update({
      where: { id: existing.id },
      data: { is_active: false }
    });

    await logActivity({
      company_id,
      user_id: req.user.id,
      action: 'CLIENT_CATEGORY_REMOVED',
      entity_type: 'client_category',
      entity_id: existing.id,
      old_value: existing,
      new_value: { ...updated, category: existing.category }
    });

    return res.json({ message: 'Client category removed' });
  } catch (err) {
    console.error('removeClientCategory error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
