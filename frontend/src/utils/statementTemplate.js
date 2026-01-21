export const defaultStatementTemplate = {
  header_title: 'Shtiebel 48',
  header_subtitle: 'Manager',
  header_font_size: 32,
  header_color: '#1e3a8a',
  show_member_id: true,
  show_email: true,
  show_charges_section: true,
  show_payments_section: true,
  charges_color: '#d97706',
  payments_color: '#16a34a',
  balance_color: '#dc2626',
  body_font_size: 14,
  footer_text: 'Thank you for your support',
  show_footer: true,
};

export const resolveStatementTemplate = (templateOrList) => {
  const template = Array.isArray(templateOrList) ? templateOrList[0] : templateOrList;
  if (template && typeof template === 'object') {
    return { ...defaultStatementTemplate, ...template };
  }
  return defaultStatementTemplate;
};
