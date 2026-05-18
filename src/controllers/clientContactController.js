const prisma = require("../config/db");
const logActivity = require("../utils/activityLogger");

// GET /clients/:clientId/contacts
exports.getContactsByClient = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { clientId } = req.params;

    const client = await prisma.client.findFirst({
      where: { id: clientId, company_id, is_active: true },
      select: { id: true }
    });
    if (!client) return res.status(404).json({ message: "Client not found" });

    const contacts = await prisma.clientContact.findMany({
      where: { company_id, client_id: clientId, is_active: true },
      orderBy: { updated_at: "desc" }
    });

    return res.json(contacts);
  } catch (err) {
    console.error("getContactsByClient error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// POST /clients/:clientId/contacts
exports.createContact = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { clientId } = req.params;

    const { name, designation, phone, email, address } = req.body;

    if (!name) return res.status(400).json({ message: "name is required" });

    const client = await prisma.client.findFirst({
      where: { id: clientId, company_id, is_active: true },
      select: { id: true }
    });
    if (!client) return res.status(404).json({ message: "Client not found" });

    const contact = await prisma.clientContact.create({
      data: {
        company_id,
        client_id: clientId,
        name: name.toString(),
        designation: designation?.toString() || null,
        phone: phone?.toString() || null,
        email: email?.toString() || null,
        address: address?.toString() || null,
        is_active: true
      }
    });

    await logActivity({
      company_id,
      factory_id: null,
      user_id: req.user.id,
      action: "CLIENT_CONTACT_CREATED",
      entity_type: "client_contact",
      entity_id: contact.id,
      new_value: contact
    });

    return res.status(201).json(contact);
  } catch (err) {
    console.error("createContact error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// PUT /clients/:clientId/contacts/:contactId
exports.updateContact = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { clientId, contactId } = req.params;

    const existing = await prisma.clientContact.findFirst({
      where: { id: contactId, company_id, client_id: clientId, is_active: true }
    });
    if (!existing) return res.status(404).json({ message: "Contact not found" });

    const { name, designation, phone, email, address } = req.body;

    const updated = await prisma.clientContact.update({
      where: { id: contactId },
      data: {
        name: name !== undefined ? (name?.toString() || null) : undefined,
        designation: designation !== undefined ? (designation?.toString() || null) : undefined,
        phone: phone !== undefined ? (phone?.toString() || null) : undefined,
        email: email !== undefined ? (email?.toString() || null) : undefined,
        address: address !== undefined ? (address?.toString() || null) : undefined
      }
    });

    await logActivity({
      company_id,
      factory_id: null,
      user_id: req.user.id,
      action: "CLIENT_CONTACT_UPDATED",
      entity_type: "client_contact",
      entity_id: contactId,
      old_value: existing,
      new_value: updated
    });

    return res.json(updated);
  } catch (err) {
    console.error("updateContact error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// DELETE /clients/:clientId/contacts/:contactId
exports.deleteContact = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { clientId, contactId } = req.params;

    const existing = await prisma.clientContact.findFirst({
      where: { id: contactId, company_id, client_id: clientId, is_active: true }
    });
    if (!existing) return res.status(404).json({ message: "Contact not found" });

    const deleted = await prisma.clientContact.update({
      where: { id: contactId },
      data: { is_active: false }
    });

    await logActivity({
      company_id,
      factory_id: null,
      user_id: req.user.id,
      action: "CLIENT_CONTACT_DELETED",
      entity_type: "client_contact",
      entity_id: contactId,
      old_value: existing,
      new_value: deleted
    });

    return res.json({ message: "Contact deleted" });
  } catch (err) {
    console.error("deleteContact error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
